import { and, eq, isNull, sql } from 'drizzle-orm'
import { schema, withTenant, type Database } from '@fve/db'
import { money, subtract, type Currency, type Money } from '@fve/money'

import { CoreError } from './errors'
import { getRateFor, toIsoDate } from './rates'

export type PaymentMethod =
  | 'EFECTIVO_BS'
  | 'EFECTIVO_USD'
  | 'PAGO_MOVIL'
  | 'TRANSFERENCIA_BS'
  | 'PUNTO_VENTA'
  | 'ZELLE'
  | 'USDT'
  | 'CREDITO'

/** Ya hay un turno abierto en esa caja. */
export class SessionAlreadyOpenError extends CoreError {
  override readonly name = 'SessionAlreadyOpenError'
  constructor() {
    super('Esa caja ya tiene un turno abierto. Ciérrelo antes de abrir otro.')
  }
}

/** No hay turno abierto donde se esperaba uno. */
export class NoOpenSessionError extends CoreError {
  override readonly name = 'NoOpenSessionError'
  constructor() {
    super('No hay un turno de caja abierto.')
  }
}

export class SessionAlreadyClosedError extends CoreError {
  override readonly name = 'SessionAlreadyClosedError'
  constructor() {
    super('Ese turno de caja ya fue cerrado.')
  }
}

export interface OpeningAmount {
  readonly method: PaymentMethod
  readonly currency: Currency
  readonly amount: bigint
}

/**
 * Abre un turno de caja.
 *
 * El fondo de apertura se registra por medio y moneda. En un negocio
 * bimonetario la caja arranca con efectivo en bolívares y en divisa a la vez, y
 * meterlos en un solo saco hace imposible cuadrar después.
 */
export async function openCashSession(
  db: Database,
  input: {
    tenantId: string
    stationId: string
    userId: string
    opening?: readonly OpeningAmount[] | undefined
    now?: Date | undefined
  },
): Promise<{ sessionId: string }> {
  const now = input.now ?? new Date()
  const rate = await getRateFor(db, input.tenantId, toIsoDate(now))

  return withTenant(db, input.tenantId, async (tx) => {
    const open = await tx
      .select()
      .from(schema.cashSessions)
      .where(and(eq(schema.cashSessions.stationId, input.stationId), isNull(schema.cashSessions.closedAt)))
      .limit(1)

    if (open[0]) throw new SessionAlreadyOpenError()

    const [session] = await tx
      .insert(schema.cashSessions)
      .values({
        tenantId: input.tenantId,
        stationId: input.stationId,
        openedByUserId: input.userId,
        openedAt: now,
        exchangeRateId: rate.id,
      })
      .returning({ id: schema.cashSessions.id })

    if (!session) throw new NoOpenSessionError()

    const opening = input.opening ?? []
    if (opening.length > 0) {
      await tx.insert(schema.cashCounts).values(
        opening.map((row) => ({
          tenantId: input.tenantId,
          sessionId: session.id,
          method: row.method,
          currency: row.currency,
          openingAmount: row.amount,
        })),
      )
    }

    await tx.insert(schema.auditLog).values({
      tenantId: input.tenantId,
      actorUserId: input.userId,
      action: 'CREATE',
      entity: 'cash_sessions',
      entityId: session.id,
      occurredAt: now,
    })

    return { sessionId: session.id }
  })
}

/** Turno abierto de una caja, si lo hay. */
export async function getOpenSession(
  db: Database,
  tenantId: string,
  stationId: string,
): Promise<{ sessionId: string; openedAt: Date } | null> {
  const rows = await withTenant(db, tenantId, (tx) =>
    tx
      .select()
      .from(schema.cashSessions)
      .where(and(eq(schema.cashSessions.stationId, stationId), isNull(schema.cashSessions.closedAt)))
      .limit(1),
  )
  const found = rows[0]
  return found ? { sessionId: found.id, openedAt: found.openedAt } : null
}

export interface CountLine {
  readonly method: PaymentMethod
  readonly currency: Currency
  /** Fondo con que se abrió. */
  readonly opening: Money
  /** Lo que el sistema calculó a partir de los documentos del turno. */
  readonly expected: Money
  /** Lo que la persona contó físicamente. */
  readonly counted: Money
  /** Contado menos esperado. Negativo es faltante. */
  readonly difference: Money
}

export interface CashSessionSummary {
  readonly sessionId: string
  readonly openedAt: Date
  readonly closedAt: Date | null
  readonly documentCount: number
  readonly lines: readonly CountLine[]
}

/**
 * Calcula lo que debería haber en caja, por medio y moneda.
 *
 * Es fondo de apertura, más lo cobrado, menos el vuelto entregado. El vuelto se
 * descuenta del efectivo de la moneda en que se dio: si no, la caja aparece
 * siempre con un faltante que no existe.
 *
 * Los documentos anulados no cuentan: el dinero se devolvió.
 */
async function expectedByMethod(
  tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  sessionId: string,
): Promise<Map<string, bigint>> {
  const cobrado = await tx.execute<{ method: string; currency: string; total: string }>(sql`
    SELECT p.method::text AS method, p.currency::text AS currency, COALESCE(SUM(p.amount), 0)::text AS total
    FROM document_payments p
    JOIN documents d ON d.id = p.document_id
    WHERE d.cash_session_id = ${sessionId} AND d.status = 'ISSUED'
    GROUP BY p.method, p.currency
  `)

  const totals = new Map<string, bigint>()
  for (const row of cobrado) {
    // El crédito no entra a la caja: es una promesa de pago.
    if (row.method === 'CREDITO') continue
    totals.set(`${row.method}|${row.currency}`, BigInt(row.total))
  }

  const vuelto = await tx.execute<{ currency: string; total: string }>(sql`
    SELECT d.change_currency::text AS currency, COALESCE(SUM(d.change_amount), 0)::text AS total
    FROM documents d
    WHERE d.cash_session_id = ${sessionId} AND d.status = 'ISSUED' AND d.change_amount > 0
    GROUP BY d.change_currency
  `)

  for (const row of vuelto) {
    const method = row.currency === 'USD' ? 'EFECTIVO_USD' : 'EFECTIVO_BS'
    const key = `${method}|${row.currency}`
    totals.set(key, (totals.get(key) ?? 0n) - BigInt(row.total))
  }

  return totals
}

/** Estado actual del turno, con o sin conteo. */
export async function getCashSessionSummary(
  db: Database,
  tenantId: string,
  sessionId: string,
): Promise<CashSessionSummary> {
  return withTenant(db, tenantId, async (tx) => {
    const rows = await tx.select().from(schema.cashSessions).where(eq(schema.cashSessions.id, sessionId)).limit(1)
    const session = rows[0]
    if (!session) throw new NoOpenSessionError()

    const counts = await tx.select().from(schema.cashCounts).where(eq(schema.cashCounts.sessionId, sessionId))
    const expected = await expectedByMethod(tx, sessionId)

    const documentCount = await tx.execute<{ total: string }>(sql`
      SELECT COUNT(*)::text AS total FROM documents
      WHERE cash_session_id = ${sessionId} AND status = 'ISSUED'
    `)

    // Toda combinación que aparezca en el conteo o en lo cobrado tiene que
    // figurar en el arqueo, aunque el fondo de apertura fuera cero.
    const keys = new Set<string>([
      ...counts.map((row) => `${row.method}|${row.currency}`),
      ...expected.keys(),
    ])

    const lines: CountLine[] = [...keys].map((key) => {
      const [method, currency] = key.split('|') as [PaymentMethod, Currency]
      const stored = counts.find((row) => row.method === method && row.currency === currency)
      const opening = stored?.openingAmount ?? 0n
      const expectedTotal = opening + (expected.get(key) ?? 0n)
      const counted = stored?.countedAmount ?? 0n

      return {
        method,
        currency,
        opening: money(currency, opening),
        expected: money(currency, expectedTotal),
        counted: money(currency, counted),
        difference: subtract(money(currency, counted), money(currency, expectedTotal)),
      }
    })

    lines.sort((a, b) => a.method.localeCompare(b.method) || a.currency.localeCompare(b.currency))

    return {
      sessionId: session.id,
      openedAt: session.openedAt,
      closedAt: session.closedAt,
      documentCount: Number([...documentCount][0]?.total ?? '0'),
      lines,
    }
  })
}

/**
 * Cierra el turno con el conteo físico.
 *
 * Se guardan las dos cifras —lo esperado y lo contado— y la diferencia queda a
 * la vista. Ajustar el esperado para que cuadre sería exactamente lo que este
 * arqueo existe para impedir: un descuadre visible es información, uno tapado
 * es un robo que nadie va a notar.
 */
export async function closeCashSession(
  db: Database,
  input: {
    tenantId: string
    sessionId: string
    userId: string
    counted: readonly OpeningAmount[]
    notes?: string | undefined
    now?: Date | undefined
  },
): Promise<CashSessionSummary> {
  const now = input.now ?? new Date()

  await withTenant(db, input.tenantId, async (tx) => {
    const rows = await tx
      .select()
      .from(schema.cashSessions)
      .where(eq(schema.cashSessions.id, input.sessionId))
      .limit(1)

    const session = rows[0]
    if (!session) throw new NoOpenSessionError()
    if (session.closedAt !== null) throw new SessionAlreadyClosedError()

    const expected = await expectedByMethod(tx, input.sessionId)
    const existing = await tx.select().from(schema.cashCounts).where(eq(schema.cashCounts.sessionId, input.sessionId))

    const keys = new Set<string>([
      ...existing.map((row) => `${row.method}|${row.currency}`),
      ...expected.keys(),
      ...input.counted.map((row) => `${row.method}|${row.currency}`),
    ])

    for (const key of keys) {
      const [method, currency] = key.split('|') as [PaymentMethod, Currency]
      const stored = existing.find((row) => row.method === method && row.currency === currency)
      const opening = stored?.openingAmount ?? 0n
      const counted = input.counted.find((row) => row.method === method && row.currency === currency)?.amount ?? 0n
      const expectedTotal = opening + (expected.get(key) ?? 0n)

      await tx
        .insert(schema.cashCounts)
        .values({
          tenantId: input.tenantId,
          sessionId: input.sessionId,
          method,
          currency,
          openingAmount: opening,
          expectedAmount: expectedTotal,
          countedAmount: counted,
        })
        .onConflictDoUpdate({
          target: [schema.cashCounts.sessionId, schema.cashCounts.method, schema.cashCounts.currency],
          set: { expectedAmount: expectedTotal, countedAmount: counted },
        })
    }

    await tx
      .update(schema.cashSessions)
      .set({ closedAt: now, closedByUserId: input.userId, notes: input.notes ?? null })
      .where(eq(schema.cashSessions.id, input.sessionId))

    await tx.insert(schema.auditLog).values({
      tenantId: input.tenantId,
      actorUserId: input.userId,
      action: 'UPDATE',
      entity: 'cash_sessions',
      entityId: input.sessionId,
      after: { closed: true },
      occurredAt: now,
    })
  })

  return getCashSessionSummary(db, input.tenantId, input.sessionId)
}
