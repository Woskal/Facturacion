import { desc, eq, sql } from 'drizzle-orm'
import { schema, withTenant, type Database } from '@fve/db'
import { convert, money, usd as dolares, type Currency, type Money } from '@fve/money'

import { CoreError } from './errors'
import { assertPlatformAdmin } from './platform'
import { getRateFor, toIsoDate, type IsoDate } from './rates'

export type BillingPeriod = 'MENSUAL' | 'SEMESTRAL' | 'ANUAL'
export type SubscriptionStatus = 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'CANCELLED'

export class SubscriptionNotFoundError extends CoreError {
  override readonly name = 'SubscriptionNotFoundError'
  constructor() {
    super('Este negocio no tiene suscripción registrada.')
  }
}

/** Meses que cubre cada período. */
export const MESES_POR_PERIODO: Readonly<Record<BillingPeriod, number>> = Object.freeze({
  MENSUAL: 1,
  SEMESTRAL: 6,
  ANUAL: 12,
})

/** Duración de la prueba gratuita. */
export const DIAS_DE_PRUEBA = 15

function sumarMeses(desde: IsoDate, meses: number): IsoDate {
  const [año, mes, dia] = desde.split('-').map(Number) as [number, number, number]
  // Se construye en UTC para que el resultado no dependa del huso del servidor.
  const fecha = new Date(Date.UTC(año, mes - 1 + meses, dia))
  return fecha.toISOString().slice(0, 10)
}

function sumarDias(desde: IsoDate, dias: number): IsoDate {
  const fecha = new Date(`${desde}T00:00:00Z`)
  fecha.setUTCDate(fecha.getUTCDate() + dias)
  return fecha.toISOString().slice(0, 10)
}

/**
 * Abre la suscripción de un negocio con su prueba gratuita.
 *
 * Se llama al dar de alta el negocio. La prueba empieza sola: pedirle a alguien
 * que active su propia prueba es perder clientes en el primer paso.
 */
export async function startSubscription(
  db: Database,
  input: {
    tenantId: string
    priceUsd: Money
    period?: BillingPeriod | undefined
    trialDays?: number | undefined
    now?: Date | undefined
  },
): Promise<void> {
  const now = input.now ?? new Date()
  const hasta = sumarDias(toIsoDate(now), input.trialDays ?? DIAS_DE_PRUEBA)

  await withTenant(db, input.tenantId, (tx) =>
    tx
      .insert(schema.subscriptions)
      .values({
        tenantId: input.tenantId,
        status: 'TRIAL',
        period: input.period ?? 'MENSUAL',
        priceUsd: input.priceUsd.amount,
        paidThrough: hasta,
      })
      .onConflictDoNothing(),
  )
}

export interface SubscriptionView {
  readonly tenantId: string
  readonly status: SubscriptionStatus
  readonly period: BillingPeriod
  readonly price: Money
  readonly paidThrough: IsoDate
  readonly graceDays: number
  /** Días que faltan para vencer. Negativo si ya venció. */
  readonly daysLeft: number
  /** Si el servicio debe cortarse ya. */
  readonly shouldSuspend: boolean
}

function diasEntre(desde: IsoDate, hasta: IsoDate): number {
  const a = new Date(`${desde}T00:00:00Z`).getTime()
  const b = new Date(`${hasta}T00:00:00Z`).getTime()
  return Math.round((b - a) / 86_400_000)
}

function evaluar(
  fila: typeof schema.subscriptions.$inferSelect,
  hoy: IsoDate,
): SubscriptionView {
  const daysLeft = diasEntre(hoy, fila.paidThrough)
  const vencidoHace = -daysLeft

  return {
    tenantId: fila.tenantId,
    status: fila.status,
    period: fila.period,
    price: money('USD', fila.priceUsd),
    paidThrough: fila.paidThrough,
    graceDays: fila.graceDays,
    daysLeft,
    shouldSuspend: fila.status !== 'CANCELLED' && vencidoHace > fila.graceDays,
  }
}

export async function getSubscription(
  db: Database,
  tenantId: string,
  now: Date = new Date(),
): Promise<SubscriptionView> {
  const filas = await withTenant(db, tenantId, (tx) =>
    tx.select().from(schema.subscriptions).where(eq(schema.subscriptions.tenantId, tenantId)).limit(1),
  )

  const fila = filas[0]
  if (!fila) throw new SubscriptionNotFoundError()
  return evaluar(fila, toIsoDate(now))
}

/**
 * Registra un pago y extiende el servicio.
 *
 * Desde dónde se extiende depende de si el servicio siguió andando:
 *
 *  - Al día o dentro de la gracia: se extiende desde la fecha ya pagada. Quien
 *    paga con tres días de retraso siguió usando el sistema esos tres días, y
 *    cobrárselos igual pero recortarle el mes sería cobrar dos veces.
 *  - Ya cortado: se extiende desde hoy. Cobrarle los meses en que estuvo
 *    suspendido sería cobrarle por un servicio que no tuvo.
 *
 * El límite es exactamente el punto donde se le cortó, que es la única línea
 * que se puede defender en una conversación de cobranza.
 */
export async function registerSubscriptionPayment(
  db: Database,
  input: {
    tenantId: string
    actorUserId: string
    amount: Money
    method: string
    reference?: string | undefined
    periods?: number | undefined
    now?: Date | undefined
  },
): Promise<SubscriptionView> {
  await assertPlatformAdmin(db, input.actorUserId)

  const now = input.now ?? new Date()
  const hoy = toIsoDate(now)
  const rate = await getRateFor(db, input.tenantId, hoy)
  const periodos = input.periods ?? 1

  return withTenant(db, input.tenantId, async (tx) => {
    const filas = await tx
      .select()
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.tenantId, input.tenantId))
      .limit(1)

    const suscripcion = filas[0]
    if (!suscripcion) throw new SubscriptionNotFoundError()

    const vencidoHace = diasEntre(suscripcion.paidThrough, hoy)
    const seguiaAndando = vencidoHace <= suscripcion.graceDays
    const desde = seguiaAndando ? suscripcion.paidThrough : hoy
    const hasta = sumarMeses(desde, MESES_POR_PERIODO[suscripcion.period] * periodos)

    await tx.insert(schema.subscriptionPayments).values({
      tenantId: input.tenantId,
      subscriptionId: suscripcion.id,
      currency: input.amount.currency,
      amount: input.amount.amount,
      amountUsd: convert(input.amount, 'USD', rate).amount,
      method: input.method as never,
      reference: input.reference ?? null,
      periods: periodos,
      paidThroughAfter: hasta,
      receivedAt: now,
      registeredByUserId: input.actorUserId,
    })

    await tx
      .update(schema.subscriptions)
      .set({ paidThrough: hasta, status: 'ACTIVE', updatedAt: now })
      .where(eq(schema.subscriptions.id, suscripcion.id))

    await tx.insert(schema.auditLog).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: 'UPDATE',
      entity: 'subscriptions',
      entityId: suscripcion.id,
      after: { paidThrough: hasta, monto: input.amount.amount.toString() },
      occurredAt: now,
    })

    return evaluar({ ...suscripcion, paidThrough: hasta, status: 'ACTIVE' }, hoy)
  })
}

/** Cambia el plan o el precio de un negocio. */
export async function updateSubscription(
  db: Database,
  input: {
    tenantId: string
    actorUserId: string
    period?: BillingPeriod | undefined
    priceUsd?: Money | undefined
    graceDays?: number | undefined
    notes?: string | undefined
  },
): Promise<void> {
  await assertPlatformAdmin(db, input.actorUserId)

  const cambios: Record<string, unknown> = { updatedAt: new Date() }
  if (input.period !== undefined) cambios['period'] = input.period
  if (input.priceUsd !== undefined) cambios['priceUsd'] = input.priceUsd.amount
  if (input.graceDays !== undefined) cambios['graceDays'] = input.graceDays
  if (input.notes !== undefined) cambios['notes'] = input.notes

  await withTenant(db, input.tenantId, (tx) =>
    tx.update(schema.subscriptions).set(cambios).where(eq(schema.subscriptions.tenantId, input.tenantId)),
  )
}

export interface EnforcementResult {
  readonly revisados: number
  readonly suspendidos: readonly string[]
  readonly enGracia: readonly string[]
}

/**
 * Corta el servicio a quien venció y pasó su período de gracia.
 *
 * Reusa la suspensión que ya existía: se archiva el negocio y se cierran sus
 * sesiones. Nada se borra — los datos siguen ahí para cuando el cliente se
 * ponga al día, porque borrarle la contabilidad a alguien por una factura
 * vencida sería indefendible.
 *
 * Marcar a quien está en gracia también importa: es la lista de a quién hay que
 * llamar antes de cortarle.
 */
export async function enforceSubscriptions(
  db: Database,
  now: Date = new Date(),
): Promise<EnforcementResult> {
  const hoy = toIsoDate(now)
  const negocios = await db
    .select({ id: schema.tenants.id, archivedAt: schema.tenants.archivedAt })
    .from(schema.tenants)

  const suspendidos: string[] = []
  const enGracia: string[] = []
  let revisados = 0

  for (const negocio of negocios) {
    const filas = await withTenant(db, negocio.id, (tx) =>
      tx.select().from(schema.subscriptions).where(eq(schema.subscriptions.tenantId, negocio.id)).limit(1),
    )

    const fila = filas[0]
    if (!fila) continue
    revisados += 1

    const estado = evaluar(fila, hoy)

    if (estado.shouldSuspend && negocio.archivedAt === null) {
      await db.update(schema.tenants).set({ archivedAt: now }).where(eq(schema.tenants.id, negocio.id))
      await db.execute(sql`
        UPDATE sessions SET revoked_at = ${now.toISOString()}
        WHERE active_tenant_id = ${negocio.id} AND revoked_at IS NULL
      `)
      await withTenant(db, negocio.id, (tx) =>
        tx
          .update(schema.subscriptions)
          .set({ status: 'SUSPENDED', updatedAt: now })
          .where(eq(schema.subscriptions.id, fila.id)),
      )
      suspendidos.push(negocio.id)
      continue
    }

    if (estado.daysLeft < 0 && !estado.shouldSuspend) {
      if (fila.status !== 'PAST_DUE') {
        await withTenant(db, negocio.id, (tx) =>
          tx
            .update(schema.subscriptions)
            .set({ status: 'PAST_DUE', updatedAt: now })
            .where(eq(schema.subscriptions.id, fila.id)),
        )
      }
      enGracia.push(negocio.id)
      continue
    }

    // Pagó estando suspendido: se le devuelve el servicio.
    if (estado.daysLeft >= 0 && negocio.archivedAt !== null && fila.status === 'ACTIVE') {
      await db.update(schema.tenants).set({ archivedAt: null }).where(eq(schema.tenants.id, negocio.id))
    }
  }

  return { revisados, suspendidos, enGracia }
}

export interface SubscriptionSummary extends SubscriptionView {
  readonly tenantName: string
  readonly rif: string
  readonly suspended: boolean
  readonly lastPaymentAt: Date | null
}

/**
 * Panel de cobranza del operador.
 *
 * Ordena por lo que vence primero: es la lista de a quién hay que llamar hoy.
 */
export async function listSubscriptions(
  db: Database,
  actorUserId: string,
  now: Date = new Date(),
): Promise<SubscriptionSummary[]> {
  await assertPlatformAdmin(db, actorUserId)
  const hoy = toIsoDate(now)

  const negocios = await db.select().from(schema.tenants).orderBy(desc(schema.tenants.createdAt))
  const resumen: SubscriptionSummary[] = []

  for (const negocio of negocios) {
    const datos = await withTenant(db, negocio.id, async (tx) => {
      const filas = await tx
        .select()
        .from(schema.subscriptions)
        .where(eq(schema.subscriptions.tenantId, negocio.id))
        .limit(1)

      if (!filas[0]) return null

      const pagos = await tx
        .select({ receivedAt: schema.subscriptionPayments.receivedAt })
        .from(schema.subscriptionPayments)
        .where(eq(schema.subscriptionPayments.tenantId, negocio.id))
        .orderBy(desc(schema.subscriptionPayments.receivedAt))
        .limit(1)

      return { suscripcion: filas[0], ultimoPago: pagos[0]?.receivedAt ?? null }
    })

    if (!datos) continue

    resumen.push({
      ...evaluar(datos.suscripcion, hoy),
      tenantName: negocio.name,
      rif: `${negocio.rifKind}-${negocio.rifNumber}`,
      suspended: negocio.archivedAt !== null,
      lastPaymentAt: datos.ultimoPago,
    })
  }

  return resumen.sort((a, b) => a.daysLeft - b.daysLeft)
}

/** Historial de pagos de un negocio. */
export async function listSubscriptionPayments(
  db: Database,
  input: { tenantId: string; actorUserId: string },
): Promise<
  { receivedAt: Date; amount: Money; method: string; reference: string | null; paidThroughAfter: string }[]
> {
  await assertPlatformAdmin(db, input.actorUserId)

  const filas = await withTenant(db, input.tenantId, (tx) =>
    tx
      .select()
      .from(schema.subscriptionPayments)
      .where(eq(schema.subscriptionPayments.tenantId, input.tenantId))
      .orderBy(desc(schema.subscriptionPayments.receivedAt)),
  )

  return filas.map((fila) => ({
    receivedAt: fila.receivedAt,
    amount: money(fila.currency as Currency, fila.amount),
    method: fila.method,
    reference: fila.reference,
    paidThroughAfter: fila.paidThroughAfter,
  }))
}

/** Precio por defecto del plan único: quince dólares al mes. */
export const PRECIO_MENSUAL_POR_DEFECTO = dolares(1500n)
