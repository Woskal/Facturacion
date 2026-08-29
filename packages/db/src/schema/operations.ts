import { relations, sql } from 'drizzle-orm'
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

import { amount, archivedAt, createdAt, primaryId, rateScaled, updatedAt } from './columns'
import { currency, paymentMethod, receivableEntryKind, stockMovementKind } from './enums'
import { customers, exchangeRates, products } from './catalog'
import { documents } from './sales'
import { stations, tenants, users } from './tenancy'

// --- Inventario -------------------------------------------------------------

/**
 * Movimiento de existencia.
 *
 * La existencia actual no se guarda como columna: se deriva de los movimientos.
 * Un saldo guardado y un histórico de movimientos siempre terminan
 * discrepando, y entonces no hay forma de saber cuál miente.
 */
export const stockMovements = pgTable(
  'stock_movements',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    kind: stockMovementKind('kind').notNull(),
    /** Cantidad en milésimas. Negativa cuando sale del inventario. */
    quantity: amount('quantity').notNull(),
    /** Documento que originó el movimiento, si lo hubo. */
    documentId: uuid('document_id').references(() => documents.id),
    reason: text('reason'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (table) => [
    index('stock_movements_tenant_product_idx').on(table.tenantId, table.productId),
    index('stock_movements_document_idx').on(table.documentId),
  ],
)

// --- Gastos -----------------------------------------------------------------

export const expenseCategories = pgTable(
  'expense_categories',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  (table) => [uniqueIndex('expense_categories_tenant_name_unique').on(table.tenantId, table.name)],
)

export const expenses = pgTable(
  'expenses',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id').references(() => expenseCategories.id),
    description: text('description').notNull(),
    currency: currency('currency').notNull(),
    amount: amount('amount').notNull(),
    amountUsd: amount('amount_usd').notNull(),
    amountVes: amount('amount_ves').notNull(),
    exchangeRateId: uuid('exchange_rate_id')
      .notNull()
      .references(() => exchangeRates.id),
    rateBsPerUsd: rateScaled('rate_bs_per_usd').notNull(),
    paidWith: paymentMethod('paid_with'),
    reference: text('reference'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index('expenses_tenant_occurred_idx').on(table.tenantId, table.occurredAt)],
)

// --- Cuentas por cobrar -----------------------------------------------------

/**
 * Saldo pendiente de un documento vendido a crédito.
 */
export const receivables = pgTable(
  'receivables',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    currency: currency('currency').notNull(),
    originalAmount: amount('original_amount').notNull(),
    dueOn: timestamp('due_on', { withTimezone: true }),
    settledAt: timestamp('settled_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('receivables_document_unique').on(table.documentId),
    index('receivables_tenant_customer_idx').on(table.tenantId, table.customerId),
  ],
)

/**
 * Cada abono contra una cuenta por cobrar.
 *
 * El tipo incluye retención de IVA e ISLR desde el día uno, aunque el módulo de
 * retenciones no exista todavía. Un contribuyente especial retiene el 75% o el
 * 100% del IVA al pagar: si la cartera no admite ese abono, queda un saldo que
 * nunca se cobrará y que tampoco se puede cerrar. Agregarlo después obligaría a
 * migrar cobros ya registrados.
 */
export const receivableEntries = pgTable(
  'receivable_entries',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    receivableId: uuid('receivable_id')
      .notNull()
      .references(() => receivables.id, { onDelete: 'cascade' }),
    kind: receivableEntryKind('kind').notNull(),
    currency: currency('currency').notNull(),
    amount: amount('amount').notNull(),
    amountUsd: amount('amount_usd').notNull(),
    amountVes: amount('amount_ves').notNull(),
    exchangeRateId: uuid('exchange_rate_id')
      .notNull()
      .references(() => exchangeRates.id),
    rateBsPerUsd: rateScaled('rate_bs_per_usd').notNull(),
    method: paymentMethod('method'),
    reference: text('reference'),
    /** Número del comprobante de retención, cuando el abono es una retención. */
    retentionNumber: text('retention_number'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    createdAt: createdAt(),
  },
  (table) => [index('receivable_entries_receivable_idx').on(table.receivableId)],
)

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

export const stockMovementsRelations = relations(stockMovements, ({ one }) => ({
  product: one(products, { fields: [stockMovements.productId], references: [products.id] }),
  document: one(documents, { fields: [stockMovements.documentId], references: [documents.id] }),
}))

export const expensesRelations = relations(expenses, ({ one }) => ({
  category: one(expenseCategories, { fields: [expenses.categoryId], references: [expenseCategories.id] }),
}))

export const receivablesRelations = relations(receivables, ({ one, many }) => ({
  document: one(documents, { fields: [receivables.documentId], references: [documents.id] }),
  customer: one(customers, { fields: [receivables.customerId], references: [customers.id] }),
  entries: many(receivableEntries),
}))

export const receivableEntriesRelations = relations(receivableEntries, ({ one }) => ({
  receivable: one(receivables, { fields: [receivableEntries.receivableId], references: [receivables.id] }),
}))

export const cashSessionsRelations = relations(cashSessions, ({ one, many }) => ({
  station: one(stations, { fields: [cashSessions.stationId], references: [stations.id] }),
  counts: many(cashCounts),
}))

export const cashCountsRelations = relations(cashCounts, ({ one }) => ({
  session: one(cashSessions, { fields: [cashCounts.sessionId], references: [cashSessions.id] }),
}))
