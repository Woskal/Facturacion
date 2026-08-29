import { relations } from 'drizzle-orm'
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

import { createdAt, primaryId, updatedAt } from './columns'
import { stations, tenants, users } from './tenancy'

/**
 * Una sesión abierta.
 *
 * **Es tabla de plataforma, no de negocio, y por eso queda fuera del aislamiento
 * por seguridad por fila** — igual que `users`. Dos razones:
 *
 *  1. El login ocurre antes de que exista contexto de negocio. Cuál es el
 *     negocio es justamente lo que el login viene a averiguar.
 *  2. Una sesión pertenece a una persona, no a un negocio. Un contador con tres
 *     clientes abre una sesión y cambia de negocio dentro de ella.
 *
 * Por eso la columna se llama `active_tenant_id` y no `tenant_id`. No es un
 * rodeo para esquivar el guardarraíl de cobertura: es el nombre correcto.
 * `tenant_id` significa «esta fila pertenece a este negocio»; aquí significa
 * «esta sesión tiene seleccionado este negocio», que es otra cosa.
 *
 * El token nunca se guarda en claro: se persiste su SHA-256. Una filtración de
 * la base no debe entregar sesiones utilizables.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Negocio seleccionado. Nulo hasta que el usuario elige uno. */
    activeTenantId: uuid('active_tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    /** Caja desde la que se abrió la sesión, cuando aplica. */
    stationId: uuid('station_id').references(() => stations.id, { onDelete: 'set null' }),
    /** SHA-256 del token en hexadecimal. El token en claro solo lo tiene el cliente. */
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('sessions_token_hash_unique').on(table.tokenHash),
    index('sessions_user_idx').on(table.userId),
    index('sessions_active_tenant_idx').on(table.activeTenantId),
  ],
)

/**
 * PIN de desbloqueo de una caja concreta.
 *
 * No es una identidad aparte: el correo y la contraseña siguen siendo la
 * credencial de registro. Esto es solo una forma rápida de reabrir una sesión ya
 * autorizada en la caja, y lo que hace posible seguir vendiendo cuando se cae el
 * internet — que en Venezuela pasa a diario.
 *
 * Sí lleva `tenant_id` y sí va bajo aislamiento: una estación siempre pertenece
 * a un negocio ya conocido cuando esto se usa.
 */
export const stationCredentials = pgTable(
  'station_credentials',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    stationId: uuid('station_id')
      .notNull()
      .references(() => stations.id, { onDelete: 'cascade' }),
    /** Hash argon2id del PIN. Nunca el PIN. */
    pinHash: text('pin_hash').notNull(),
    enabledAt: createdAt(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex('station_credentials_station_user_unique').on(table.stationId, table.userId)],
)

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
  activeTenant: one(tenants, { fields: [sessions.activeTenantId], references: [tenants.id] }),
  station: one(stations, { fields: [sessions.stationId], references: [stations.id] }),
}))

export const stationCredentialsRelations = relations(stationCredentials, ({ one }) => ({
  tenant: one(tenants, { fields: [stationCredentials.tenantId], references: [tenants.id] }),
  user: one(users, { fields: [stationCredentials.userId], references: [users.id] }),
  station: one(stations, { fields: [stationCredentials.stationId], references: [stations.id] }),
}))
