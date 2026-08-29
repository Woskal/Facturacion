import { and, eq, isNull, ne, sql } from 'drizzle-orm'
import { schema, type Database } from '@fve/db'

import { InvalidSessionError } from './errors'
import { generateToken, hashToken } from './token'

/** Duración por defecto de una sesión: doce horas, un turno de caja largo. */
export const DEFAULT_SESSION_TTL_MS = 12 * 60 * 60 * 1000

export interface IssueSessionInput {
  readonly userId: string
  readonly activeTenantId?: string | undefined
  readonly stationId?: string | undefined
  readonly ttlMs?: number
  readonly ipAddress?: string | undefined
  readonly userAgent?: string | undefined
  readonly now?: Date
}

export interface IssuedSession {
  /** El token en claro. Es la única vez que existe fuera del cliente. */
  readonly token: string
  readonly sessionId: string
  readonly expiresAt: Date
}

export async function issueSession(db: Database, input: IssueSessionInput): Promise<IssuedSession> {
  const now = input.now ?? new Date()
  const expiresAt = new Date(now.getTime() + (input.ttlMs ?? DEFAULT_SESSION_TTL_MS))
  const token = generateToken()

  const [row] = await db
    .insert(schema.sessions)
    .values({
      userId: input.userId,
      activeTenantId: input.activeTenantId ?? null,
      stationId: input.stationId ?? null,
      tokenHash: hashToken(token),
      expiresAt,
      lastSeenAt: now,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    })
    .returning({ id: schema.sessions.id })

  if (!row) throw new InvalidSessionError('No se pudo abrir la sesión.')

  return { token, sessionId: row.id, expiresAt }
}

export interface ActiveSession {
  readonly sessionId: string
  readonly userId: string
  readonly activeTenantId: string | null
  readonly stationId: string | null
  readonly expiresAt: Date
}

/**
 * Valida un token y devuelve la sesión activa.
 *
 * La búsqueda es por hash del token, que está indexado y es único: no hay que
 * recorrer sesiones ni comparar una por una. Expirada, revocada o inexistente
 * producen el mismo error, porque al cliente le da igual la razón.
 */
export async function verifySession(db: Database, token: string, now: Date = new Date()): Promise<ActiveSession> {
  const rows = await db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.tokenHash, hashToken(token)))
    .limit(1)

  const session = rows[0]
  if (!session) throw new InvalidSessionError()
  if (session.revokedAt !== null) throw new InvalidSessionError()
  if (session.expiresAt.getTime() <= now.getTime()) throw new InvalidSessionError()

  return {
    sessionId: session.id,
    userId: session.userId,
    activeTenantId: session.activeTenantId,
    stationId: session.stationId,
    expiresAt: session.expiresAt,
  }
}

/** Marca actividad. Se llama al validar, para saber qué sesiones siguen vivas. */
export async function touchSession(db: Database, sessionId: string, now: Date = new Date()): Promise<void> {
  await db.update(schema.sessions).set({ lastSeenAt: now }).where(eq(schema.sessions.id, sessionId))
}

export async function revokeSession(db: Database, sessionId: string, now: Date = new Date()): Promise<void> {
  await db
    .update(schema.sessions)
    .set({ revokedAt: now })
    .where(and(eq(schema.sessions.id, sessionId), isNull(schema.sessions.revokedAt)))
}

/** Cierra todas las sesiones de una persona, opcionalmente salvo una. */
export async function revokeAllSessionsForUser(
  db: Database,
  userId: string,
  options: { exceptSessionId?: string; now?: Date } = {},
): Promise<number> {
  const now = options.now ?? new Date()
  const condition = options.exceptSessionId
    ? and(
        eq(schema.sessions.userId, userId),
        isNull(schema.sessions.revokedAt),
        ne(schema.sessions.id, options.exceptSessionId),
      )
    : and(eq(schema.sessions.userId, userId), isNull(schema.sessions.revokedAt))

  const revoked = await db.update(schema.sessions).set({ revokedAt: now }).where(condition).returning({
    id: schema.sessions.id,
  })
  return revoked.length
}

/**
 * Cierra las sesiones que tuvieran activo un negocio del que la persona ya no
 * forma parte.
 *
 * Se llama al retirar una membresía. Sin esto, quitarle el acceso a alguien no
 * surte efecto hasta que su sesión expire — que es justamente lo que las
 * sesiones opacas vinieron a evitar.
 */
export async function revokeSessionsForMembership(
  db: Database,
  userId: string,
  tenantId: string,
  now: Date = new Date(),
): Promise<number> {
  const revoked = await db
    .update(schema.sessions)
    .set({ revokedAt: now })
    .where(
      and(
        eq(schema.sessions.userId, userId),
        eq(schema.sessions.activeTenantId, tenantId),
        isNull(schema.sessions.revokedAt),
      ),
    )
    .returning({ id: schema.sessions.id })
  return revoked.length
}

/** Borra sesiones caducadas hace tiempo. Tarea de mantenimiento. */
export async function purgeExpiredSessions(db: Database, olderThan: Date): Promise<number> {
  const deleted = await db
    .delete(schema.sessions)
    .where(sql`${schema.sessions.expiresAt} < ${olderThan.toISOString()}`)
    .returning({ id: schema.sessions.id })
  return deleted.length
}
