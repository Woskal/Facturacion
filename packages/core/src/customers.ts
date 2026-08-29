import { and, eq, isNull, sql } from 'drizzle-orm'
import { schema, withTenant, type Database } from '@fve/db'
import { convert, money, subtract, type Currency, type Money } from '@fve/money'

import { CoreError } from './errors'
import { getRateFor, toIsoDate } from './rates'

export type IdKind = 'V' | 'E' | 'J' | 'G' | 'P'

export class DuplicateCustomerError extends CoreError {
  override readonly name = 'DuplicateCustomerError'
  constructor(readonly id: string) {
    super(`Ya existe un cliente con la identificación ${id}.`)
  }
}

export class CustomerNotFoundError extends CoreError {
  override readonly name = 'CustomerNotFoundError'
  constructor() {
    super('El cliente no existe.')
  }
}

export class ReceivableNotFoundError extends CoreError {
  override readonly name = 'ReceivableNotFoundError'
  constructor() {
    super('La cuenta por cobrar no existe.')
  }
}

export class OverpaidReceivableError extends CoreError {
  override readonly name = 'OverpaidReceivableError'
  constructor(readonly pending: string) {
    super(`El abono excede el saldo pendiente, que es ${pending}.`)
  }
}

export interface CreateCustomerInput {
  readonly tenantId: string
  readonly idKind: IdKind
  readonly idNumber: string
  readonly name: string
  readonly phone?: string | undefined
  readonly email?: string | undefined
  readonly address?: string | undefined
  /** Si retiene IVA al pagar. Cambia cómo se salda su cuenta. */
  readonly specialTaxpayer?: boolean | undefined
  readonly creditLimit?: bigint | undefined
}

export async function createCustomer(db: Database, input: CreateCustomerInput): Promise<{ customerId: string }> {
  return withTenant(db, input.tenantId, async (tx) => {
    const existing = await tx
      .select({ id: schema.customers.id })
      .from(schema.customers)
      .where(
        and(
          eq(schema.customers.tenantId, input.tenantId),
          eq(schema.customers.idKind, input.idKind),
          eq(schema.customers.idNumber, input.idNumber),
        ),
      )
      .limit(1)

    if (existing[0]) throw new DuplicateCustomerError(`${input.idKind}-${input.idNumber}`)

    const [customer] = await tx
      .insert(schema.customers)
      .values({
        tenantId: input.tenantId,
        idKind: input.idKind,
        idNumber: input.idNumber,
        name: input.name,
        phone: input.phone ?? null,
        email: input.email ?? null,
        address: input.address ?? null,
        specialTaxpayer: input.specialTaxpayer ?? false,
        creditLimit: input.creditLimit ?? 0n,
      })
      .returning({ id: schema.customers.id })

    if (!customer) throw new CustomerNotFoundError()
    return { customerId: customer.id }
  })
}

export async function updateCustomer(
  db: Database,
  input: {
    tenantId: string
    customerId: string
    name?: string | undefined
    phone?: string | null | undefined
    email?: string | null | undefined
    address?: string | null | undefined
    specialTaxpayer?: boolean | undefined
    creditLimit?: bigint | undefined
  },
): Promise<void> {
  const changes: Record<string, unknown> = {}
  if (input.name !== undefined) changes['name'] = input.name
  if (input.phone !== undefined) changes['phone'] = input.phone
  if (input.email !== undefined) changes['email'] = input.email
  if (input.address !== undefined) changes['address'] = input.address
  if (input.specialTaxpayer !== undefined) changes['specialTaxpayer'] = input.specialTaxpayer
  if (input.creditLimit !== undefined) changes['creditLimit'] = input.creditLimit
  if (Object.keys(changes).length === 0) return

  await withTenant(db, input.tenantId, (tx) =>
    tx
      .update(schema.customers)
      .set({ ...changes, updatedAt: new Date() })
      .where(eq(schema.customers.id, input.customerId)),
  )
}

export async function archiveCustomer(
  db: Database,
  input: { tenantId: string; customerId: string; now?: Date | undefined },
): Promise<void> {
  const now = input.now ?? new Date()
  await withTenant(db, input.tenantId, (tx) =>
    tx.update(schema.customers).set({ archivedAt: now }).where(eq(schema.customers.id, input.customerId)),
  )
}

export interface CustomerView {
  readonly customerId: string
  readonly id: string
  readonly name: string
  readonly phone: string | null
  readonly specialTaxpayer: boolean
  readonly openReceivables: number
}

/** Busca clientes por nombre o identificación. */
export async function searchCustomers(
  db: Database,
  input: { tenantId: string; query?: string | undefined; limit?: number | undefined },
): Promise<CustomerView[]> {
  const pattern = `%${(input.query ?? '').trim()}%`
  const limit = input.limit ?? 50

  const rows = await withTenant(db, input.tenantId, (tx) =>
    tx.execute<{
      id: string
      identificacion: string
      name: string
      phone: string | null
      special_taxpayer: boolean
      open_receivables: string
    }>(sql`
      SELECT c.id,
             c.id_kind || '-' || c.id_number AS identificacion,
             c.name, c.phone, c.special_taxpayer,
             COUNT(r.id) FILTER (WHERE r.settled_at IS NULL)::text AS open_receivables
      FROM customers c
      LEFT JOIN receivables r ON r.customer_id = c.id
      WHERE c.archived_at IS NULL
        AND (${pattern} = '%%'
             OR c.name ILIKE ${pattern}
             OR c.id_number ILIKE ${pattern}
             OR (c.id_kind || '-' || c.id_number) ILIKE ${pattern})
      GROUP BY c.id
      ORDER BY c.name
      LIMIT ${limit}
    `),
  )

  return [...rows].map((row) => ({
    customerId: row.id,
    id: row.identificacion,
    name: row.name,
    phone: row.phone,
    specialTaxpayer: row.special_taxpayer,
    openReceivables: Number(row.open_receivables),
  }))
}

// --- Cuentas por cobrar -----------------------------------------------------

export type ReceivableEntryKind = 'PAYMENT' | 'RETENTION_IVA' | 'RETENTION_ISLR' | 'CREDIT_NOTE' | 'WRITE_OFF'

export interface ReceivableView {
  readonly receivableId: string
  readonly documentId: string
  readonly fullNumber: string
  readonly customerId: string
  readonly customerName: string
  readonly currency: Currency
  readonly original: Money
  readonly paid: Money
  readonly balance: Money
  readonly settled: boolean
}

/**
 * Cartera pendiente.
 *
 * El saldo se calcula sumando los abonos en la moneda de la deuda. Cada abono
 * guardó su importe en las dos monedas con la tasa del día en que se pagó, así
 * que una deuda en dólares abonada en bolívares se reduce por lo que ese pago
 * valía ESE día — que es como se cobra de verdad, no con la tasa de hoy.
 */
export async function listReceivables(
  db: Database,
  input: { tenantId: string; customerId?: string | undefined; includeSettled?: boolean | undefined },
): Promise<ReceivableView[]> {
  const rows = await withTenant(db, input.tenantId, (tx) =>
    tx.execute<{
      id: string
      document_id: string
      full_number: string
      customer_id: string
      customer_name: string
      currency: Currency
      original_amount: string
      paid: string
      settled_at: string | null
    }>(sql`
      SELECT r.id, r.document_id, d.full_number, r.customer_id, c.name AS customer_name,
             r.currency, r.original_amount::text AS original_amount, r.settled_at,
             COALESCE(SUM(
               CASE WHEN r.currency = 'USD' THEN e.amount_usd ELSE e.amount_ves END
             ), 0)::text AS paid
      FROM receivables r
      JOIN documents d ON d.id = r.document_id
      JOIN customers c ON c.id = r.customer_id
      LEFT JOIN receivable_entries e ON e.receivable_id = r.id
      WHERE (${input.customerId ?? null}::uuid IS NULL OR r.customer_id = ${input.customerId ?? null}::uuid)
        AND (${input.includeSettled ?? false} OR r.settled_at IS NULL)
      GROUP BY r.id, d.full_number, c.name
      ORDER BY r.created_at
    `),
  )

  return [...rows].map((row) => {
    const original = money(row.currency, BigInt(row.original_amount))
    const paid = money(row.currency, BigInt(row.paid))
    return {
      receivableId: row.id,
      documentId: row.document_id,
      fullNumber: row.full_number,
      customerId: row.customer_id,
      customerName: row.customer_name,
      currency: row.currency,
      original,
      paid,
      balance: subtract(original, paid),
      settled: row.settled_at !== null,
    }
  })
}

/**
 * Registra un abono contra una cuenta por cobrar.
 *
 * Los tipos de retención existen desde el primer día aunque no haya módulo de
 * retenciones: un contribuyente especial retiene el 75% o el 100% del IVA al
 * pagar, y sin poder registrar ese abono la cartera queda con un saldo que nadie
 * va a cobrar nunca y que tampoco se puede cerrar.
 *
 * Cuando el saldo llega a cero la cuenta se marca saldada sola.
 */
export async function addReceivableEntry(
  db: Database,
  input: {
    tenantId: string
    userId: string
    receivableId: string
    kind: ReceivableEntryKind
    amount: Money
    method?: string | undefined
    reference?: string | undefined
    retentionNumber?: string | undefined
    now?: Date | undefined
  },
): Promise<{ balance: Money; settled: boolean }> {
  const now = input.now ?? new Date()
  const rate = await getRateFor(db, input.tenantId, toIsoDate(now))

  return withTenant(db, input.tenantId, async (tx) => {
    const rows = await tx
      .select()
      .from(schema.receivables)
      .where(eq(schema.receivables.id, input.receivableId))
      .limit(1)

    const receivable = rows[0]
    if (!receivable) throw new ReceivableNotFoundError()

    const paidRows = await tx.execute<{ paid: string }>(sql`
      SELECT COALESCE(SUM(
        CASE WHEN ${receivable.currency} = 'USD' THEN amount_usd ELSE amount_ves END
      ), 0)::text AS paid
      FROM receivable_entries WHERE receivable_id = ${input.receivableId}
    `)

    const paidSoFar = BigInt([...paidRows][0]?.paid ?? '0')
    const pending = receivable.originalAmount - paidSoFar

    const inDebtCurrency = convert(input.amount, receivable.currency, rate)
    if (inDebtCurrency.amount > pending) {
      throw new OverpaidReceivableError(
        `${pending} en unidades menores de ${receivable.currency}`,
      )
    }

    await tx.insert(schema.receivableEntries).values({
      tenantId: input.tenantId,
      receivableId: input.receivableId,
      kind: input.kind,
      currency: input.amount.currency,
      amount: input.amount.amount,
      amountUsd: convert(input.amount, 'USD', rate).amount,
      amountVes: convert(input.amount, 'VES', rate).amount,
      exchangeRateId: rate.id,
      rateBsPerUsd: rate.bsPerUsd,
      method: (input.method as never) ?? null,
      reference: input.reference ?? null,
      retentionNumber: input.retentionNumber ?? null,
      occurredAt: now,
      createdByUserId: input.userId,
    })

    const balanceAmount = pending - inDebtCurrency.amount
    const settled = balanceAmount === 0n

    if (settled) {
      await tx
        .update(schema.receivables)
        .set({ settledAt: now })
        .where(eq(schema.receivables.id, input.receivableId))
    }

    await tx.insert(schema.auditLog).values({
      tenantId: input.tenantId,
      actorUserId: input.userId,
      action: 'CREATE',
      entity: 'receivable_entries',
      entityId: input.receivableId,
      after: { kind: input.kind, amount: input.amount.amount.toString() },
      occurredAt: now,
    })

    return { balance: money(receivable.currency, balanceAmount), settled }
  })
}

/** Documentos emitidos a un cliente, del más reciente al más antiguo. */
export async function customerHistory(
  db: Database,
  input: { tenantId: string; customerId: string; limit?: number | undefined },
) {
  return withTenant(db, input.tenantId, (tx) =>
    tx
      .select({
        documentId: schema.documents.id,
        fullNumber: schema.documents.fullNumber,
        kind: schema.documents.kind,
        status: schema.documents.status,
        issuedAt: schema.documents.issuedAt,
        currency: schema.documents.currency,
        totalUsd: schema.documents.totalUsd,
        totalVes: schema.documents.totalVes,
      })
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.tenantId, input.tenantId),
          eq(schema.documents.customerId, input.customerId),
          isNull(schema.documents.voidedAt),
        ),
      )
      .orderBy(schema.documents.issuedAt)
      .limit(input.limit ?? 50),
  )
}
