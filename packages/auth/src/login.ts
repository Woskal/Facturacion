import { and, eq, isNull } from 'drizzle-orm'
import { schema, withUser, type Database } from '@fve/db'

import type { MemberRole } from './roles'
import {
  AccountLockedError,
  InvalidCredentialsError,
  InvalidSessionError,
  MembershipRequiredError,
} from './errors'
import { decoyHash, hashPassword, verifyPassword } from './password'
import { issueSession, revokeAllSessionsForUser, type IssuedSession } from './sessions'

/** Intentos fallidos consecutivos antes de bloquear. */
export const MAX_FAILED_ATTEMPTS = 10

/** Duración del bloqueo. */
export const LOCK_DURATION_MS = 15 * 60 * 1000

export interface Membership {
  readonly tenantId: string
  readonly tenantName: string
  readonly role: MemberRole
}

/**
 * Negocios a los que pertenece una persona.
 *
 * Se apoya en la política `memberships_self_read`, que permite a alguien leer
 * SUS PROPIAS membresías sin negocio activo. Es la salida al problema de que el
 * login necesita esta información antes de saber a qué negocio va a entrar.
 *
 * El primer intento fue una función `SECURITY DEFINER`, y no sirve: `FORCE ROW
 * LEVEL SECURITY` aplica también al dueño de las tablas, así que la función
 * seguía sujeta a la política y devolvía cero filas. Hacerla funcionar habría
 * exigido un rol con `BYPASSRLS`, un privilegio desproporcionado para esto.
 *
 * La política concede lo mínimo: leer que uno pertenece a un negocio es
 * información que uno ya tiene. Escribir en `memberships` sigue exigiendo
 * contexto de negocio.
 */
export async function listMemberships(db: Database, userId: string): Promise<Membership[]> {
  return withUser(db, userId, async (tx) => {
    const rows = await tx
      .select({
        tenantId: schema.memberships.tenantId,
        tenantName: schema.tenants.name,
        role: schema.memberships.role,
      })
      .from(schema.memberships)
      .innerJoin(schema.tenants, eq(schema.tenants.id, schema.memberships.tenantId))
      .where(
        and(
          eq(schema.memberships.userId, userId),
          isNull(schema.memberships.archivedAt),
          isNull(schema.tenants.archivedAt),
        ),
      )
      .orderBy(schema.tenants.name)

    return rows.map((row) => ({ tenantId: row.tenantId, tenantName: row.tenantName, role: row.role }))
  })
}

export interface AuthenticateInput {
  readonly email: string
  readonly password: string
  readonly stationId?: string | undefined
  readonly ipAddress?: string | undefined
  readonly userAgent?: string | undefined
  readonly now?: Date
}

export interface AuthenticateResult {
  readonly userId: string
  readonly fullName: string
  readonly memberships: readonly Membership[]
  readonly session: IssuedSession
}

/**
 * Verifica credenciales y abre una sesión.
 *
 * La sesión nace **sin negocio activo** aunque la persona pertenezca a uno solo.
 * Elegir negocio es un paso explícito: así el mismo código sirve para el dueño
 * de una bodega y para el contador que atiende cinco, y no hay una rama especial
 * que mantener.
 */
export async function authenticate(db: Database, input: AuthenticateInput): Promise<AuthenticateResult> {
  const now = input.now ?? new Date()
  const email = input.email.trim().toLowerCase()

  const rows = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1)
  const user = rows[0]

  if (!user || user.archivedAt !== null) {
    // Se verifica igual contra un hash señuelo para que la respuesta tarde lo
    // mismo que con un correo real. Si no, el tiempo delata qué cuentas existen.
    await verifyPassword(await decoyHash(), input.password)
    throw new InvalidCredentialsError()
  }

  if (user.lockedUntil !== null && user.lockedUntil.getTime() > now.getTime()) {
    throw new AccountLockedError(user.lockedUntil)
  }

  const matches = await verifyPassword(user.passwordHash, input.password)

  if (!matches) {
    const failed = user.failedAttempts + 1
    const locked = failed >= MAX_FAILED_ATTEMPTS
    await db
      .update(schema.users)
      .set({
        failedAttempts: locked ? 0 : failed,
        lockedUntil: locked ? new Date(now.getTime() + LOCK_DURATION_MS) : user.lockedUntil,
      })
      .where(eq(schema.users.id, user.id))
    throw new InvalidCredentialsError()
  }

  if (user.failedAttempts !== 0 || user.lockedUntil !== null) {
    await db
      .update(schema.users)
      .set({ failedAttempts: 0, lockedUntil: null })
      .where(eq(schema.users.id, user.id))
  }

  const memberships = await listMemberships(db, user.id)

  const session = await issueSession(db, {
    userId: user.id,
    stationId: input.stationId,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
    now,
  })

  return { userId: user.id, fullName: user.fullName, memberships, session }
}

/**
 * Selecciona el negocio activo de una sesión.
 *
 * Valida la membresía contra la base en cada cambio, no contra lo que el cliente
 * diga. Pasar el identificador de un negocio ajeno no debe abrirlo: debe fallar.
 */
export async function selectTenant(
  db: Database,
  sessionId: string,
  tenantId: string,
): Promise<{ tenantId: string; role: MemberRole }> {
  const rows = await db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).limit(1)
  const session = rows[0]
  if (!session || session.revokedAt !== null) throw new InvalidSessionError()

  const memberships = await listMemberships(db, session.userId)
  const membership = memberships.find((candidate) => candidate.tenantId === tenantId)
  if (!membership) throw new MembershipRequiredError()

  await db
    .update(schema.sessions)
    .set({ activeTenantId: tenantId })
    .where(eq(schema.sessions.id, sessionId))

  return { tenantId: membership.tenantId, role: membership.role }
}

/**
 * Cambia la contraseña y cierra todas las demás sesiones.
 *
 * Cambiar la contraseña es lo que hace alguien que sospecha que le entraron a la
 * cuenta. Si las otras sesiones siguieran abiertas, no habría servido de nada.
 */
export async function changePassword(
  db: Database,
  input: {
    userId: string
    currentPassword: string
    newPassword: string
    keepSessionId?: string | undefined
    now?: Date
  },
): Promise<void> {
  const rows = await db.select().from(schema.users).where(eq(schema.users.id, input.userId)).limit(1)
  const user = rows[0]
  if (!user) throw new InvalidCredentialsError()

  const matches = await verifyPassword(user.passwordHash, input.currentPassword)
  if (!matches) throw new InvalidCredentialsError()

  await db
    .update(schema.users)
    .set({ passwordHash: await hashPassword(input.newPassword), failedAttempts: 0, lockedUntil: null })
    .where(eq(schema.users.id, input.userId))

  await revokeAllSessionsForUser(db, input.userId, {
    ...(input.keepSessionId !== undefined ? { exceptSessionId: input.keepSessionId } : {}),
    ...(input.now !== undefined ? { now: input.now } : {}),
  })
}
