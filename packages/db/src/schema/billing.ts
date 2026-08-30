import { relations } from 'drizzle-orm'
import { date, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

import { amount, createdAt, primaryId, updatedAt } from './columns'
import { billingPeriod, currency, paymentMethod, subscriptionStatus } from './enums'
import { tenants, users } from './tenancy'

/**
 * Suscripción de un negocio al servicio.
 *
 * Va bajo aislamiento como cualquier otra tabla del negocio, aunque quien la
 * administra sea el operador de la plataforma. Es la misma decisión que en el
 * panel de negocios: el operador lee negocio por negocio dentro de su contexto,
 * en vez de que exista un rol capaz de leerlo todo.
 *
 * El precio se guarda en dólares. En Venezuela un servicio se cotiza en divisa
 * y se cobra en lo que el cliente traiga; guardar el precio en bolívares
 * significaría corregirlo cada semana.
 */
export const subscriptions = pgTable(
  'subscriptions',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    status: subscriptionStatus('status').notNull().default('TRIAL'),
    period: billingPeriod('period').notNull().default('MENSUAL'),
    /** Precio del período completo, en centavos de dólar. */
    priceUsd: amount('price_usd').notNull(),
    /**
     * Hasta cuándo está pago el servicio.
     *
     * Es una fecha, no una marca de tiempo: nadie discute a qué hora vence una
     * suscripción, y una fecha se explica sola en una conversación de cobranza.
     */
    paidThrough: date('paid_through').notNull(),
    /**
     * Días de gracia tras el vencimiento antes de cortar.
     *
     * Existen porque el pago en Venezuela es manual y tarda: cortarle el
     * servicio a alguien que ya transfirió pero cuyo comprobante no se ha
     * revisado es la forma más rápida de perder un cliente.
     */
    graceDays: integer('grace_days').notNull().default(5),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('subscriptions_tenant_unique').on(table.tenantId),
    index('subscriptions_paid_through_idx').on(table.paidThrough),
  ],
)

/**
 * Pago de suscripción registrado a mano.
 *
 * En Venezuela no hay una pasarela que cobre sola: el cliente transfiere por
 * pago móvil, Zelle o USDT y alguien revisa el comprobante. Por eso cada pago
 * guarda su referencia y quién lo dio por bueno — es lo único que permite
 * reconstruir una cobranza discutida.
 */
export const subscriptionPayments = pgTable(
  'subscription_payments',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    subscriptionId: uuid('subscription_id')
      .notNull()
      .references(() => subscriptions.id, { onDelete: 'cascade' }),
    currency: currency('currency').notNull(),
    amount: amount('amount').notNull(),
    amountUsd: amount('amount_usd').notNull(),
    method: paymentMethod('method').notNull(),
    reference: text('reference'),
    /** Cuántos períodos cubre el pago. */
    periods: integer('periods').notNull().default(1),
    /** Hasta dónde quedó pago el servicio después de este pago. */
    paidThroughAfter: date('paid_through_after').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    registeredByUserId: uuid('registered_by_user_id').references(() => users.id),
    createdAt: createdAt(),
  },
  (table) => [index('subscription_payments_tenant_idx').on(table.tenantId, table.receivedAt)],
)

export const subscriptionsRelations = relations(subscriptions, ({ one, many }) => ({
  tenant: one(tenants, { fields: [subscriptions.tenantId], references: [tenants.id] }),
  payments: many(subscriptionPayments),
}))

export const subscriptionPaymentsRelations = relations(subscriptionPayments, ({ one }) => ({
  subscription: one(subscriptions, {
    fields: [subscriptionPayments.subscriptionId],
    references: [subscriptions.id],
  }),
}))
