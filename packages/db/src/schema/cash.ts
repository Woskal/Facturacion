import { relations, sql } from 'drizzle-orm'
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

import { amount, createdAt, primaryId, updatedAt } from './columns'
import { currency, paymentMethod } from './enums'
import { exchangeRates } from './catalog'
import { stations, tenants, users } from './tenancy'

// --- Caja -------------------------------------------------------------------

/**
 * Turno de caja. Abre, se vende contra ella, y cierra con arqueo.
 */
export const cashSessions = pgTable(
  'cash_sessions',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    stationId: uuid('station_id')
      .notNull()
      .references(() => stations.id),
    openedByUserId: uuid('opened_by_user_id')
      .notNull()
      .references(() => users.id),
    closedByUserId: uuid('closed_by_user_id').references(() => users.id),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    exchangeRateId: uuid('exchange_rate_id')
      .notNull()
      .references(() => exchangeRates.id),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index('cash_sessions_tenant_station_idx').on(table.tenantId, table.stationId)],
)

/**
 * Arqueo: lo que el sistema dice que debería haber frente a lo que el cajero
 * contó, por moneda y por medio de pago.
 *
 * Se guardan las dos cifras y la diferencia. Ajustar el conteo para que cuadre
 * sería exactamente lo que este renglón existe para impedir.
 */
export const cashCounts = pgTable(
  'cash_counts',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => cashSessions.id, { onDelete: 'cascade' }),
    method: paymentMethod('method').notNull(),
    currency: currency('currency').notNull(),
    /** Monto con que se abrió la caja. */
    openingAmount: amount('opening_amount').notNull().default(sql`0`),
    /** Lo que el sistema calculó a partir de los documentos del turno. */
    expectedAmount: amount('expected_amount').notNull().default(sql`0`),
    /** Lo que el cajero contó físicamente. */
    countedAmount: amount('counted_amount').notNull().default(sql`0`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex('cash_counts_session_method_currency_unique').on(table.sessionId, table.method, table.currency)],
)

export const cashSessionsRelations = relations(cashSessions, ({ one, many }) => ({
  station: one(stations, { fields: [cashSessions.stationId], references: [stations.id] }),
  counts: many(cashCounts),
}))

export const cashCountsRelations = relations(cashCounts, ({ one }) => ({
  session: one(cashSessions, { fields: [cashCounts.sessionId], references: [cashSessions.id] }),
}))
