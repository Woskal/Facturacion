import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { schema, withTenant, type Database } from '@fve/db'
import { hashPassword, revokeSessionsForMembership } from '@fve/auth'

import { CoreError } from './errors'
import { PRECIO_MENSUAL_POR_DEFECTO, startSubscription } from './subscriptions'
import type { IdKind } from './customers'

/** Quien intenta la operación no es operador de la plataforma. */
export class NotPlatformAdminError extends CoreError {
  override readonly name = 'NotPlatformAdminError'
  constructor() {
    super('Esta operación es del operador de la plataforma.')
  }
}

export class TenantAlreadyExistsError extends CoreError {
  override readonly name = 'TenantAlreadyExistsError'
  constructor(readonly rif: string) {
    super(`Ya existe un negocio con el RIF ${rif}.`)
  }
}

export class UserAlreadyExistsError extends CoreError {
  override readonly name = 'UserAlreadyExistsError'
  constructor(readonly email: string) {
    super(`Ya existe una cuenta con el correo ${email}.`)
  }
}

export class TenantNotFoundError extends CoreError {
  override readonly name = 'TenantNotFoundError'
  constructor() {
    super('El negocio no existe.')
  }
}

/**
 * Verifica que quien opera sea el operador de la plataforma.
 *
 * Se comprueba contra la base en cada operación, no contra lo que traiga la
 * sesión: quitarle la condición de operador a alguien tiene que surtir efecto de
 * inmediato, no cuando su sesión expire.
 */
export async function assertPlatformAdmin(db: Database, userId: string): Promise<void> {
  const rows = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1)
  const user = rows[0]
  if (!user || user.archivedAt !== null || !user.isPlatformAdmin) {
    throw new NotPlatformAdminError()
  }
}

export interface CreateTenantInput {
  readonly actorUserId: string
  readonly name: string
  readonly rifKind: IdKind
  readonly rifNumber: string
  readonly tradeName?: string | undefined
  readonly address?: string | undefined
  readonly phone?: string | undefined
  readonly specialTaxpayer?: boolean | undefined
  readonly igtfBps?: number | undefined
  readonly now?: Date | undefined
}

export interface CreatedTenant {
  readonly tenantId: string
  readonly stationId: string
  readonly priceListId: string
  readonly taxRateIds: Readonly<Record<string, string>>
  readonly seriesIds: Readonly<Record<string, string>>
}

/**
 * Da de alta un negocio y lo deja listo para vender.
 *
 * Un negocio vacío no sirve: sin alícuotas, lista de precios, caja y series de
 * numeración no se puede emitir ni un documento. Provisionar todo eso en el alta
 * evita que el cliente tenga que configurar cosas que nunca va a querer tocar, y
 * que el operador tenga que acordarse de crearlas a mano.
 *
 * El catálogo NO se siembra: los productos los carga cada negocio, porque solo
 * el dueño sabe qué vende.
 */
export async function createTenant(db: Database, input: CreateTenantInput): Promise<CreatedTenant> {
  await assertPlatformAdmin(db, input.actorUserId)
  const now = input.now ?? new Date()

  const existing = await db
    .select({ id: schema.tenants.id })
    .from(schema.tenants)
    .where(and(eq(schema.tenants.rifKind, input.rifKind), eq(schema.tenants.rifNumber, input.rifNumber)))
    .limit(1)

  if (existing[0]) throw new TenantAlreadyExistsError(`${input.rifKind}-${input.rifNumber}`)

  const [tenant] = await db
    .insert(schema.tenants)
    .values({
      name: input.name,
      rifKind: input.rifKind,
      rifNumber: input.rifNumber,
      tradeName: input.tradeName ?? null,
      address: input.address ?? null,
      phone: input.phone ?? null,
      specialTaxpayer: input.specialTaxpayer ?? false,
      igtfBps: input.igtfBps ?? 300,
    })
    .returning({ id: schema.tenants.id })

  if (!tenant) throw new TenantNotFoundError()
  const tenantId = tenant.id

  // La prueba gratuita empieza sola. Pedirle a alguien que active su propia
  // prueba es perder clientes en el primer paso.
  await startSubscription(db, { tenantId, priceUsd: PRECIO_MENSUAL_POR_DEFECTO, now })

  return withTenant(db, tenantId, async (tx) => {
    // Alícuotas vigentes. Son datos del negocio, no constantes del código,
    // porque cambian por decreto y cada quien puede ajustarlas.
    const alicuotas = [
      { code: 'G', name: 'General 16%', baseBps: 1600, adicionalBps: 0, isDefault: true },
      { code: 'R', name: 'Reducida 8%', baseBps: 800, adicionalBps: 0, isDefault: false },
      { code: 'S', name: 'General 16% + adicional 15%', baseBps: 1600, adicionalBps: 1500, isDefault: false },
      { code: 'E', name: 'Exento', baseBps: 0, adicionalBps: 0, isDefault: false },
    ]

    const taxRows = await tx
      .insert(schema.taxRates)
      .values(alicuotas.map((row) => ({ tenantId, ...row })))
      .returning({ id: schema.taxRates.id, code: schema.taxRates.code })

    const [priceList] = await tx
      .insert(schema.priceLists)
      .values({ tenantId, name: 'Detal', isDefault: true })
      .returning({ id: schema.priceLists.id })

    const [station] = await tx
      .insert(schema.stations)
      .values({ tenantId, name: 'Caja 1', code: 'C1' })
      .returning({ id: schema.stations.id })

    const series = [
      { kind: 'FACTURA' as const, prefix: 'F' },
      { kind: 'NOTA_ENTREGA' as const, prefix: 'NE' },
      { kind: 'PRESUPUESTO' as const, prefix: 'PR' },
      { kind: 'RECIBO' as const, prefix: 'RE' },
      { kind: 'NOTA_CREDITO' as const, prefix: 'NC' },
    ]

    const seriesRows = await tx
      .insert(schema.documentSeries)
      .values(series.map((row) => ({ tenantId, kind: row.kind, prefix: row.prefix, nextNumber: 1 })))
      .returning({ id: schema.documentSeries.id, kind: schema.documentSeries.kind })

    if (!priceList || !station) throw new TenantNotFoundError()

    await tx.insert(schema.auditLog).values({
      tenantId,
      actorUserId: input.actorUserId,
      action: 'CREATE',
      entity: 'tenants',
      entityId: tenantId,
      after: { name: input.name, rif: `${input.rifKind}-${input.rifNumber}` },
      occurredAt: now,
    })

    return {
      tenantId,
      stationId: station.id,
      priceListId: priceList.id,
      taxRateIds: Object.fromEntries(taxRows.map((row) => [row.code, row.id])),
      seriesIds: Object.fromEntries(seriesRows.map((row) => [row.kind, row.id])),
    }
  })
}

export interface CreateUserInput {
  readonly actorUserId: string
  readonly email: string
  readonly fullName: string
  readonly password: string
  /** Negocio al que queda asignado. Si va vacío, la cuenta nace sin negocio. */
  readonly tenantId?: string | undefined
  readonly now?: Date | undefined
}

/**
 * Crea una cuenta y, si se indica, la asigna a un negocio.
 *
 * El correo es único en toda la plataforma: una persona tiene una cuenta y ve
 * los negocios a los que pertenece, en vez de una cuenta por negocio.
 */
export async function createUser(db: Database, input: CreateUserInput): Promise<{ userId: string }> {
  await assertPlatformAdmin(db, input.actorUserId)
  const now = input.now ?? new Date()
  const email = input.email.trim().toLowerCase()

  const existing = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email)).limit(1)
  if (existing[0]) throw new UserAlreadyExistsError(email)

  const [user] = await db
    .insert(schema.users)
    .values({ email, fullName: input.fullName, passwordHash: await hashPassword(input.password) })
    .returning({ id: schema.users.id })

  if (!user) throw new UserAlreadyExistsError(email)

  if (input.tenantId) {
    await attachUserToTenant(db, {
      actorUserId: input.actorUserId,
      userId: user.id,
      tenantId: input.tenantId,
      now,
    })
  }

  return { userId: user.id }
}

/**
 * Asigna una cuenta a un negocio.
 *
 * Queda en la bitácora del negocio. El operador de la plataforma puede darle
 * acceso a quien sea —incluido a sí mismo—, y eso es inherente a operar el
 * servicio; lo que no puede es hacerlo sin dejar rastro.
 */
export async function attachUserToTenant(
  db: Database,
  input: { actorUserId: string; userId: string; tenantId: string; now?: Date | undefined },
): Promise<void> {
  await assertPlatformAdmin(db, input.actorUserId)
  const now = input.now ?? new Date()

  const tenant = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.id, input.tenantId)).limit(1)
  if (!tenant[0]) throw new TenantNotFoundError()

  await withTenant(db, input.tenantId, async (tx) => {
    await tx
      .insert(schema.memberships)
      .values({ tenantId: input.tenantId, userId: input.userId, role: 'OWNER' })
      .onConflictDoUpdate({
        target: [schema.memberships.tenantId, schema.memberships.userId],
        set: { archivedAt: null },
      })

    await tx.insert(schema.auditLog).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: 'CREATE',
      entity: 'memberships',
      entityId: input.userId,
      after: { userId: input.userId },
      occurredAt: now,
    })
  })
}

/**
 * Retira a una cuenta de un negocio y cierra sus sesiones en él.
 *
 * Sin cerrar las sesiones, quitar el acceso no surte efecto hasta que expiren —
 * que es justamente lo que las sesiones revocables vinieron a evitar.
 */
export async function detachUserFromTenant(
  db: Database,
  input: { actorUserId: string; userId: string; tenantId: string; now?: Date | undefined },
): Promise<void> {
  await assertPlatformAdmin(db, input.actorUserId)
  const now = input.now ?? new Date()

  await withTenant(db, input.tenantId, async (tx) => {
    await tx
      .update(schema.memberships)
      .set({ archivedAt: now })
      .where(and(eq(schema.memberships.tenantId, input.tenantId), eq(schema.memberships.userId, input.userId)))

    await tx.insert(schema.auditLog).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: 'DELETE',
      entity: 'memberships',
      entityId: input.userId,
      occurredAt: now,
    })
  })

  await revokeSessionsForMembership(db, input.userId, input.tenantId, now)
}

export interface TenantSummary {
  readonly tenantId: string
  readonly name: string
  readonly rif: string
  readonly userCount: number
  readonly suspended: boolean
  readonly createdAt: Date
}

/**
 * Negocios de la plataforma, del más reciente al más antiguo.
 *
 * El conteo de cuentas se hace negocio por negocio, cambiando el contexto dentro
 * de UNA sola transacción. Podría parecer que un `LEFT JOIN` sería más directo,
 * pero no funciona: `memberships` está bajo aislamiento y sin contexto de
 * negocio devuelve cero filas —incluso para el operador de la plataforma, que es
 * exactamente como debe ser—.
 *
 * La alternativa sería un rol con `BYPASSRLS`, y no vale la pena: son unas pocas
 * consultas rápidas en una pantalla que se abre de vez en cuando. Si algún día
 * hay miles de negocios y esto pesa, ese es el momento de reconsiderarlo, no
 * antes.
 */
export async function listTenants(db: Database, actorUserId: string): Promise<TenantSummary[]> {
  await assertPlatformAdmin(db, actorUserId)

  const tenants = await db
    .select()
    .from(schema.tenants)
    .orderBy(desc(schema.tenants.createdAt))

  return db.transaction(async (tx) => {
    const summaries: TenantSummary[] = []

    for (const tenant of tenants) {
      await tx.execute(sql`select set_config('app.tenant_id', ${tenant.id}, true)`)
      const counted = await tx.execute<{ total: string }>(
        sql`SELECT COUNT(*)::text AS total FROM memberships WHERE archived_at IS NULL`,
      )

      summaries.push({
        tenantId: tenant.id,
        name: tenant.name,
        rif: `${tenant.rifKind}-${tenant.rifNumber}`,
        userCount: Number([...counted][0]?.total ?? '0'),
        suspended: tenant.archivedAt !== null,
        createdAt: tenant.createdAt,
      })
    }

    return summaries
  })
}

/**
 * Suspende un negocio y cierra las sesiones que lo tuvieran activo.
 *
 * Es la palanca comercial: se deja de pagar y se corta el servicio. No borra
 * nada — los datos siguen ahí para cuando el cliente se ponga al día, y borrar
 * la contabilidad de alguien por una factura vencida sería indefendible.
 */
export async function suspendTenant(
  db: Database,
  input: { actorUserId: string; tenantId: string; now?: Date | undefined },
): Promise<void> {
  await assertPlatformAdmin(db, input.actorUserId)
  const now = input.now ?? new Date()

  await db.update(schema.tenants).set({ archivedAt: now }).where(eq(schema.tenants.id, input.tenantId))

  await db
    .update(schema.sessions)
    .set({ revokedAt: now })
    .where(and(eq(schema.sessions.activeTenantId, input.tenantId), isNull(schema.sessions.revokedAt)))

  await withTenant(db, input.tenantId, (tx) =>
    tx.insert(schema.auditLog).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: 'UPDATE',
      entity: 'tenants',
      entityId: input.tenantId,
      after: { suspended: true },
      occurredAt: now,
    }),
  )
}

/** Reactiva un negocio suspendido. */
export async function reactivateTenant(
  db: Database,
  input: { actorUserId: string; tenantId: string; now?: Date | undefined },
): Promise<void> {
  await assertPlatformAdmin(db, input.actorUserId)
  const now = input.now ?? new Date()

  await db.update(schema.tenants).set({ archivedAt: null }).where(eq(schema.tenants.id, input.tenantId))

  await withTenant(db, input.tenantId, (tx) =>
    tx.insert(schema.auditLog).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: 'UPDATE',
      entity: 'tenants',
      entityId: input.tenantId,
      after: { suspended: false },
      occurredAt: now,
    }),
  )
}

/** Cuentas asignadas a un negocio. */
export async function listTenantUsers(
  db: Database,
  actorUserId: string,
  tenantId: string,
): Promise<{ userId: string; email: string; fullName: string }[]> {
  await assertPlatformAdmin(db, actorUserId)

  return withTenant(db, tenantId, async (tx) => {
    const rows = await tx
      .select({ userId: schema.users.id, email: schema.users.email, fullName: schema.users.fullName })
      .from(schema.memberships)
      .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
      .where(and(eq(schema.memberships.tenantId, tenantId), isNull(schema.memberships.archivedAt)))
      .orderBy(desc(schema.users.email))
    return rows
  })
}

/**
 * Convierte a alguien en operador de la plataforma.
 *
 * Solo un operador puede nombrar a otro. El primero se crea con el script de
 * arranque, que corre en el servidor y no por la aplicación.
 */
export async function grantPlatformAdmin(
  db: Database,
  input: { actorUserId: string; userId: string },
): Promise<void> {
  await assertPlatformAdmin(db, input.actorUserId)
  await db.update(schema.users).set({ isPlatformAdmin: true }).where(eq(schema.users.id, input.userId))
}
