import { and, eq, inArray, sql } from 'drizzle-orm'
import { schema, withTenant, type Database } from '@fve/db'
import { convert, money, type Currency, type Money } from '@fve/money'

import { CoreError } from './errors'
import type { IdKind } from './customers'
import { getRateFor, toIsoDate } from './rates'

export class DuplicateSupplierError extends CoreError {
  override readonly name = 'DuplicateSupplierError'
  constructor(readonly id: string) {
    super(`Ya existe un proveedor con la identificación ${id}.`)
  }
}

export class SupplierNotFoundError extends CoreError {
  override readonly name = 'SupplierNotFoundError'
  constructor() {
    super('El proveedor no existe.')
  }
}

export class PurchaseNotFoundError extends CoreError {
  override readonly name = 'PurchaseNotFoundError'
  constructor() {
    super('La compra no existe.')
  }
}

export class EmptyPurchaseError extends CoreError {
  override readonly name = 'EmptyPurchaseError'
  constructor() {
    super('Una compra necesita al menos un renglón.')
  }
}

export class PurchaseOverpaidError extends CoreError {
  override readonly name = 'PurchaseOverpaidError'
  constructor(readonly pending: string) {
    super(`El pago excede el saldo por pagar, que es ${pending}.`)
  }
}

// --- Proveedores ------------------------------------------------------------

export interface CreateSupplierInput {
  readonly tenantId: string
  readonly idKind: IdKind
  readonly idNumber: string
  readonly name: string
  readonly contactName?: string | undefined
  readonly phone?: string | undefined
  readonly email?: string | undefined
  readonly address?: string | undefined
  readonly notes?: string | undefined
}

export async function createSupplier(db: Database, input: CreateSupplierInput): Promise<{ supplierId: string }> {
  return withTenant(db, input.tenantId, async (tx) => {
    const existing = await tx
      .select({ id: schema.suppliers.id })
      .from(schema.suppliers)
      .where(
        and(
          eq(schema.suppliers.tenantId, input.tenantId),
          eq(schema.suppliers.idKind, input.idKind),
          eq(schema.suppliers.idNumber, input.idNumber),
        ),
      )
      .limit(1)

    if (existing[0]) throw new DuplicateSupplierError(`${input.idKind}-${input.idNumber}`)

    const [supplier] = await tx
      .insert(schema.suppliers)
      .values({
        tenantId: input.tenantId,
        idKind: input.idKind,
        idNumber: input.idNumber,
        name: input.name,
        contactName: input.contactName ?? null,
        phone: input.phone ?? null,
        email: input.email ?? null,
        address: input.address ?? null,
        notes: input.notes ?? null,
      })
      .returning({ id: schema.suppliers.id })

    if (!supplier) throw new SupplierNotFoundError()
    return { supplierId: supplier.id }
  })
}

export async function updateSupplier(
  db: Database,
  input: {
    tenantId: string
    supplierId: string
    name?: string | undefined
    contactName?: string | null | undefined
    phone?: string | null | undefined
    email?: string | null | undefined
    address?: string | null | undefined
    notes?: string | null | undefined
  },
): Promise<void> {
  const changes: Record<string, unknown> = {}
  if (input.name !== undefined) changes['name'] = input.name
  if (input.contactName !== undefined) changes['contactName'] = input.contactName
  if (input.phone !== undefined) changes['phone'] = input.phone
  if (input.email !== undefined) changes['email'] = input.email
  if (input.address !== undefined) changes['address'] = input.address
  if (input.notes !== undefined) changes['notes'] = input.notes
  if (Object.keys(changes).length === 0) return

  await withTenant(db, input.tenantId, (tx) =>
    tx
      .update(schema.suppliers)
      .set({ ...changes, updatedAt: new Date() })
      .where(eq(schema.suppliers.id, input.supplierId)),
  )
}

export async function archiveSupplier(
  db: Database,
  input: { tenantId: string; supplierId: string; now?: Date | undefined },
): Promise<void> {
  const now = input.now ?? new Date()
  await withTenant(db, input.tenantId, (tx) =>
    tx.update(schema.suppliers).set({ archivedAt: now }).where(eq(schema.suppliers.id, input.supplierId)),
  )
}

export interface SupplierView {
  readonly supplierId: string
  readonly id: string
  readonly name: string
  readonly contactName: string | null
  readonly phone: string | null
  readonly email: string | null
  readonly purchaseCount: number
}

/** Busca proveedores por nombre o identificación. */
export async function searchSuppliers(
  db: Database,
  input: { tenantId: string; query?: string | undefined; limit?: number | undefined },
): Promise<SupplierView[]> {
  const pattern = `%${(input.query ?? '').trim()}%`
  const limit = input.limit ?? 50

  const rows = await withTenant(db, input.tenantId, (tx) =>
    tx.execute<{
      id: string
      identificacion: string
      name: string
      contact_name: string | null
      phone: string | null
      email: string | null
      purchase_count: string
    }>(sql`
      SELECT s.id,
             s.id_kind || '-' || s.id_number AS identificacion,
             s.name, s.contact_name, s.phone, s.email,
             COUNT(p.id)::text AS purchase_count
      FROM suppliers s
      LEFT JOIN purchases p ON p.supplier_id = s.id
      WHERE s.archived_at IS NULL
        AND (${pattern} = '%%'
             OR s.name ILIKE ${pattern}
             OR s.id_number ILIKE ${pattern}
             OR (s.id_kind || '-' || s.id_number) ILIKE ${pattern})
      GROUP BY s.id
      ORDER BY s.name
      LIMIT ${limit}
    `),
  )

  return [...rows].map((row) => ({
    supplierId: row.id,
    id: row.identificacion,
    name: row.name,
    contactName: row.contact_name,
    phone: row.phone,
    email: row.email,
    purchaseCount: Number(row.purchase_count),
  }))
}

// --- Compras ----------------------------------------------------------------

export interface PurchaseLineInput {
  readonly productId?: string | undefined
  readonly description: string
  /** Cantidad en milésimas. */
  readonly quantity: bigint
  /** Costo unitario en la moneda de la compra. */
  readonly unitCost: Money
}

export interface CreatePurchaseInput {
  readonly tenantId: string
  readonly userId: string
  readonly supplierId: string
  readonly invoiceNumber: string
  readonly controlNumber?: string | undefined
  readonly currency: Currency
  /** IVA de la factura del proveedor, tal como lo trae. Cero si no discrimina. */
  readonly iva: Money
  /** Lo que se pagó en el acto. Cero o vacío = queda a crédito por el total. */
  readonly paidNow?: Money | undefined
  readonly paidMethod?: string | undefined
  readonly notes?: string | undefined
  readonly lines: readonly PurchaseLineInput[]
  readonly now?: Date | undefined
}

/** Redondeo medio-arriba de milésimas: (costo·cantidad)/1000. */
function lineTotalOf(unitCost: Money, quantity: bigint): Money {
  return money(unitCost.currency, (unitCost.amount * quantity + 500n) / 1000n)
}

/**
 * Registra una compra.
 *
 * Todo en una transacción: guarda la compra con sus renglones y, por cada
 * renglón que sea un producto con inventario, suma la existencia con un
 * movimiento de compra. Si algo falla, no queda ni media compra ni un inventario
 * inflado. Los totales se guardan en las dos monedas con la tasa del día.
 */
export async function createPurchase(
  db: Database,
  input: CreatePurchaseInput,
): Promise<{ purchaseId: string }> {
  if (input.lines.length === 0) throw new EmptyPurchaseError()

  const now = input.now ?? new Date()
  const rate = await getRateFor(db, input.tenantId, toIsoDate(now))

  // Subtotal = suma de los renglones. Total = subtotal + IVA de la factura.
  let netAmount = 0n
  const lineTotals = input.lines.map((linea) => {
    const total = lineTotalOf(linea.unitCost, linea.quantity)
    netAmount += total.amount
    return total
  })
  const net = money(input.currency, netAmount)
  const total = money(input.currency, netAmount + input.iva.amount)

  return withTenant(db, input.tenantId, async (tx) => {
    // Existencia: solo los productos que la llevan generan movimiento.
    const productIds = input.lines
      .map((l) => l.productId)
      .filter((id): id is string => typeof id === 'string')

    const tracked = new Set<string>()
    if (productIds.length > 0) {
      const rows = await tx
        .select({ id: schema.products.id, tracksStock: schema.products.tracksStock })
        .from(schema.products)
        .where(inArray(schema.products.id, productIds))
      for (const row of rows) if (row.tracksStock) tracked.add(row.id)
    }

    const [purchase] = await tx
      .insert(schema.purchases)
      .values({
        tenantId: input.tenantId,
        supplierId: input.supplierId,
        invoiceNumber: input.invoiceNumber,
        controlNumber: input.controlNumber ?? null,
        currency: input.currency,
        exchangeRateId: rate.id,
        rateBsPerUsd: rate.bsPerUsd,
        netUsd: convert(net, 'USD', rate).amount,
        netVes: convert(net, 'VES', rate).amount,
        ivaUsd: convert(input.iva, 'USD', rate).amount,
        ivaVes: convert(input.iva, 'VES', rate).amount,
        totalUsd: convert(total, 'USD', rate).amount,
        totalVes: convert(total, 'VES', rate).amount,
        notes: input.notes ?? null,
        occurredAt: now,
        createdByUserId: input.userId,
      })
      .returning({ id: schema.purchases.id })

    if (!purchase) throw new PurchaseNotFoundError()

    for (const [i, linea] of input.lines.entries()) {
      await tx.insert(schema.purchaseLines).values({
        tenantId: input.tenantId,
        purchaseId: purchase.id,
        productId: linea.productId ?? null,
        description: linea.description,
        quantity: linea.quantity,
        unitCost: linea.unitCost.amount,
        lineTotal: lineTotals[i]!.amount,
      })

      if (linea.productId && tracked.has(linea.productId) && linea.quantity > 0n) {
        await tx.insert(schema.stockMovements).values({
          tenantId: input.tenantId,
          productId: linea.productId,
          kind: 'PURCHASE',
          quantity: linea.quantity,
          reason: `Compra ${input.invoiceNumber}`,
          createdByUserId: input.userId,
          occurredAt: now,
        })
      }
    }

    // Pago de contado, si lo hubo: entra como un abono más, así el saldo por
    // pagar sale siempre de restar los abonos al total.
    if (input.paidNow && input.paidNow.amount > 0n) {
      await tx.insert(schema.purchasePayments).values({
        tenantId: input.tenantId,
        purchaseId: purchase.id,
        currency: input.paidNow.currency,
        amount: input.paidNow.amount,
        amountUsd: convert(input.paidNow, 'USD', rate).amount,
        amountVes: convert(input.paidNow, 'VES', rate).amount,
        exchangeRateId: rate.id,
        rateBsPerUsd: rate.bsPerUsd,
        method: (input.paidMethod as never) ?? null,
        occurredAt: now,
        createdByUserId: input.userId,
      })
    }

    await tx.insert(schema.auditLog).values({
      tenantId: input.tenantId,
      actorUserId: input.userId,
      action: 'CREATE',
      entity: 'purchases',
      entityId: purchase.id,
      after: { invoiceNumber: input.invoiceNumber, total: total.amount.toString() },
      occurredAt: now,
    })

    return { purchaseId: purchase.id }
  })
}

export interface PurchaseSummary {
  readonly purchaseId: string
  readonly supplierName: string
  readonly invoiceNumber: string
  readonly controlNumber: string | null
  readonly occurredAt: Date
  readonly currency: Currency
  readonly totalVes: Money
  readonly totalUsd: Money
}

export async function listPurchases(
  db: Database,
  input: { tenantId: string; supplierId?: string | undefined; from?: string | undefined; to?: string | undefined; limit?: number | undefined },
): Promise<PurchaseSummary[]> {
  const limit = input.limit ?? 100

  const rows = await withTenant(db, input.tenantId, (tx) =>
    tx.execute<{
      id: string
      supplier_name: string
      invoice_number: string
      control_number: string | null
      occurred_at: string
      currency: Currency
      total_ves: string
      total_usd: string
    }>(sql`
      SELECT p.id, s.name AS supplier_name, p.invoice_number, p.control_number,
             p.occurred_at, p.currency,
             p.total_ves::text AS total_ves, p.total_usd::text AS total_usd
      FROM purchases p
      JOIN suppliers s ON s.id = p.supplier_id
      WHERE (${input.supplierId ?? null}::uuid IS NULL OR p.supplier_id = ${input.supplierId ?? null}::uuid)
        AND (${input.from ?? null}::date IS NULL
             OR (p.occurred_at AT TIME ZONE 'America/Caracas')::date >= ${input.from ?? null}::date)
        AND (${input.to ?? null}::date IS NULL
             OR (p.occurred_at AT TIME ZONE 'America/Caracas')::date <= ${input.to ?? null}::date)
      ORDER BY p.occurred_at DESC
      LIMIT ${limit}
    `),
  )

  return [...rows].map((row) => ({
    purchaseId: row.id,
    supplierName: row.supplier_name,
    invoiceNumber: row.invoice_number,
    controlNumber: row.control_number,
    occurredAt: new Date(row.occurred_at),
    currency: row.currency,
    totalVes: money('VES', BigInt(row.total_ves)),
    totalUsd: money('USD', BigInt(row.total_usd)),
  }))
}

export interface FullPurchase {
  readonly purchaseId: string
  readonly supplier: { name: string; id: string; phone: string | null }
  readonly invoiceNumber: string
  readonly controlNumber: string | null
  readonly currency: Currency
  readonly occurredAt: Date
  readonly net: Money
  readonly iva: Money
  readonly total: Money
  readonly paid: Money
  readonly balance: Money
  readonly notes: string | null
  readonly lines: readonly {
    description: string
    sku: string | null
    quantity: bigint
    unitCost: Money
    lineTotal: Money
  }[]
  readonly payments: readonly {
    method: string | null
    amount: Money
    reference: string | null
    occurredAt: Date
  }[]
}

/** Una compra completa, con proveedor y renglones. */
export async function getPurchase(
  db: Database,
  input: { tenantId: string; purchaseId: string },
): Promise<FullPurchase> {
  return withTenant(db, input.tenantId, async (tx) => {
    const [purchase] = await tx
      .select()
      .from(schema.purchases)
      .where(eq(schema.purchases.id, input.purchaseId))
      .limit(1)

    if (!purchase) throw new PurchaseNotFoundError()

    const [supplier] = await tx
      .select()
      .from(schema.suppliers)
      .where(eq(schema.suppliers.id, purchase.supplierId))
      .limit(1)

    const lineas = await tx
      .select({
        description: schema.purchaseLines.description,
        quantity: schema.purchaseLines.quantity,
        unitCost: schema.purchaseLines.unitCost,
        lineTotal: schema.purchaseLines.lineTotal,
        sku: schema.products.sku,
      })
      .from(schema.purchaseLines)
      .leftJoin(schema.products, eq(schema.products.id, schema.purchaseLines.productId))
      .where(eq(schema.purchaseLines.purchaseId, purchase.id))

    const pagos = await tx
      .select({
        method: schema.purchasePayments.method,
        amount: schema.purchasePayments.amount,
        currency: schema.purchasePayments.currency,
        reference: schema.purchasePayments.reference,
        occurredAt: schema.purchasePayments.occurredAt,
        amountUsd: schema.purchasePayments.amountUsd,
        amountVes: schema.purchasePayments.amountVes,
      })
      .from(schema.purchasePayments)
      .where(eq(schema.purchasePayments.purchaseId, purchase.id))
      .orderBy(schema.purchasePayments.occurredAt)

    const moneda = purchase.currency
    const propia = (usd: bigint, ves: bigint) => money(moneda, moneda === 'USD' ? usd : ves)

    const totalOwed = moneda === 'USD' ? purchase.totalUsd : purchase.totalVes
    const paidAmount = pagos.reduce((acc, p) => acc + (moneda === 'USD' ? p.amountUsd : p.amountVes), 0n)

    return {
      purchaseId: purchase.id,
      supplier: {
        name: supplier?.name ?? '',
        id: supplier ? `${supplier.idKind}-${supplier.idNumber}` : '',
        phone: supplier?.phone ?? null,
      },
      invoiceNumber: purchase.invoiceNumber,
      controlNumber: purchase.controlNumber,
      currency: moneda,
      occurredAt: purchase.occurredAt,
      net: propia(purchase.netUsd, purchase.netVes),
      iva: propia(purchase.ivaUsd, purchase.ivaVes),
      total: money(moneda, totalOwed),
      paid: money(moneda, paidAmount),
      balance: money(moneda, totalOwed - paidAmount),
      notes: purchase.notes,
      lines: lineas.map((linea) => ({
        description: linea.description,
        sku: linea.sku,
        quantity: linea.quantity,
        unitCost: money(moneda, linea.unitCost),
        lineTotal: money(moneda, linea.lineTotal),
      })),
      payments: pagos.map((p) => ({
        method: p.method,
        amount: money(p.currency, p.amount),
        reference: p.reference,
        occurredAt: p.occurredAt,
      })),
    }
  })
}

// --- Cuentas por pagar ------------------------------------------------------

export interface PayableView {
  readonly purchaseId: string
  readonly supplierId: string
  readonly supplierName: string
  readonly invoiceNumber: string
  readonly currency: Currency
  readonly total: Money
  readonly paid: Money
  readonly balance: Money
  readonly settled: boolean
}

/**
 * Compras con saldo por pagar.
 *
 * El saldo se calcula sumando los abonos en la moneda de la deuda. Cada abono
 * guardó su importe en las dos monedas con la tasa del día en que se pagó, así
 * que una deuda en dólares abonada en bolívares se reduce por lo que ese pago
 * valía ESE día, no con la tasa de hoy.
 */
export async function listPayables(
  db: Database,
  input: { tenantId: string; supplierId?: string | undefined; includeSettled?: boolean | undefined },
): Promise<PayableView[]> {
  const rows = await withTenant(db, input.tenantId, (tx) =>
    tx.execute<{
      id: string
      supplier_id: string
      supplier_name: string
      invoice_number: string
      currency: Currency
      total: string
      paid: string
    }>(sql`
      SELECT p.id, p.supplier_id, s.name AS supplier_name, p.invoice_number, p.currency,
             (CASE WHEN p.currency = 'USD' THEN p.total_usd ELSE p.total_ves END)::text AS total,
             COALESCE(SUM(
               CASE WHEN p.currency = 'USD' THEN pp.amount_usd ELSE pp.amount_ves END
             ), 0)::text AS paid
      FROM purchases p
      JOIN suppliers s ON s.id = p.supplier_id
      LEFT JOIN purchase_payments pp ON pp.purchase_id = p.id
      WHERE (${input.supplierId ?? null}::uuid IS NULL OR p.supplier_id = ${input.supplierId ?? null}::uuid)
      GROUP BY p.id, s.name
      HAVING (${input.includeSettled ?? false}
              OR (CASE WHEN p.currency = 'USD' THEN p.total_usd ELSE p.total_ves END)
                 - COALESCE(SUM(CASE WHEN p.currency = 'USD' THEN pp.amount_usd ELSE pp.amount_ves END), 0) > 0)
      ORDER BY p.occurred_at
    `),
  )

  return [...rows].map((row) => {
    const total = BigInt(row.total)
    const paid = BigInt(row.paid)
    const balance = total - paid
    return {
      purchaseId: row.id,
      supplierId: row.supplier_id,
      supplierName: row.supplier_name,
      invoiceNumber: row.invoice_number,
      currency: row.currency,
      total: money(row.currency, total),
      paid: money(row.currency, paid),
      balance: money(row.currency, balance),
      settled: balance <= 0n,
    }
  })
}

/** Registra un pago a un proveedor contra una compra. */
export async function registerPurchasePayment(
  db: Database,
  input: {
    tenantId: string
    userId: string
    purchaseId: string
    amount: Money
    method?: string | undefined
    reference?: string | undefined
    now?: Date | undefined
  },
): Promise<{ balance: Money; settled: boolean }> {
  const now = input.now ?? new Date()
  const rate = await getRateFor(db, input.tenantId, toIsoDate(now))

  return withTenant(db, input.tenantId, async (tx) => {
    const [purchase] = await tx
      .select()
      .from(schema.purchases)
      .where(eq(schema.purchases.id, input.purchaseId))
      .limit(1)

    if (!purchase) throw new PurchaseNotFoundError()

    const paidRows = await tx.execute<{ paid: string }>(sql`
      SELECT COALESCE(SUM(
        CASE WHEN ${purchase.currency} = 'USD' THEN amount_usd ELSE amount_ves END
      ), 0)::text AS paid
      FROM purchase_payments WHERE purchase_id = ${input.purchaseId}
    `)

    const paidSoFar = BigInt([...paidRows][0]?.paid ?? '0')
    const totalOwed = purchase.currency === 'USD' ? purchase.totalUsd : purchase.totalVes
    const pending = totalOwed - paidSoFar

    const inDebtCurrency = convert(input.amount, purchase.currency, rate)
    if (inDebtCurrency.amount > pending) {
      throw new PurchaseOverpaidError(`${pending} en unidades menores de ${purchase.currency}`)
    }

    await tx.insert(schema.purchasePayments).values({
      tenantId: input.tenantId,
      purchaseId: input.purchaseId,
      currency: input.amount.currency,
      amount: input.amount.amount,
      amountUsd: convert(input.amount, 'USD', rate).amount,
      amountVes: convert(input.amount, 'VES', rate).amount,
      exchangeRateId: rate.id,
      rateBsPerUsd: rate.bsPerUsd,
      method: (input.method as never) ?? null,
      reference: input.reference ?? null,
      occurredAt: now,
      createdByUserId: input.userId,
    })

    await tx.insert(schema.auditLog).values({
      tenantId: input.tenantId,
      actorUserId: input.userId,
      action: 'CREATE',
      entity: 'purchase_payments',
      entityId: input.purchaseId,
      after: { amount: input.amount.amount.toString(), currency: input.amount.currency },
      occurredAt: now,
    })

    const balanceAmount = pending - inDebtCurrency.amount
    return { balance: money(purchase.currency, balanceAmount), settled: balanceAmount === 0n }
  })
}
