import { relations } from 'drizzle-orm'
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

import { amount, archivedAt, createdAt, primaryId, rateScaled, updatedAt } from './columns'
import { currency, idKind, paymentMethod } from './enums'
import { exchangeRates, products } from './catalog'
import { tenants, users } from './tenancy'

/**
 * Proveedores.
 *
 * El espejo de `customers`, pero sin lo fiscal del cliente: a un proveedor no se
 * le retiene ni se le fía desde aquí. Guarda con quién se compra y cómo
 * contactarlo.
 */
export const suppliers = pgTable(
  'suppliers',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    idKind: idKind('id_kind').notNull(),
    idNumber: text('id_number').notNull(),
    name: text('name').notNull(),
    /** Nombre de la persona de contacto en el proveedor. */
    contactName: text('contact_name'),
    phone: text('phone'),
    email: text('email'),
    address: text('address'),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  (table) => [
    uniqueIndex('suppliers_tenant_id_unique').on(table.tenantId, table.idKind, table.idNumber),
    index('suppliers_tenant_name_idx').on(table.tenantId, table.name),
  ],
)

/**
 * Compra a un proveedor: su factura, tal como la trae.
 *
 * Los totales se copian de la factura del proveedor —no se recalculan—: es lo
 * que de verdad se pagó, con el IVA que el proveedor cobró. Se guardan en las
 * dos monedas con la tasa del día, igual que todo lo demás, para que un reporte
 * de compras del mes pasado no cambie con la tasa de hoy.
 */
export const purchases = pgTable(
  'purchases',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id),
    /** Número de la factura del proveedor, tal como viene impreso. */
    invoiceNumber: text('invoice_number').notNull(),
    /** Número de control de la factura del proveedor, si lo trae. */
    controlNumber: text('control_number'),
    currency: currency('currency').notNull(),
    exchangeRateId: uuid('exchange_rate_id')
      .notNull()
      .references(() => exchangeRates.id),
    rateBsPerUsd: rateScaled('rate_bs_per_usd').notNull(),
    /** Subtotal sin IVA. */
    netUsd: amount('net_usd').notNull(),
    netVes: amount('net_ves').notNull(),
    ivaUsd: amount('iva_usd').notNull(),
    ivaVes: amount('iva_ves').notNull(),
    totalUsd: amount('total_usd').notNull(),
    totalVes: amount('total_ves').notNull(),
    notes: text('notes'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    createdAt: createdAt(),
  },
  (table) => [index('purchases_tenant_occurred_idx').on(table.tenantId, table.occurredAt)],
)

/**
 * Renglón de una compra.
 *
 * Lleva el producto y la cantidad porque una compra suma inventario: cada
 * renglón con producto genera un movimiento de existencia. El costo unitario se
 * guarda como referencia de a cómo se compró.
 */
export const purchaseLines = pgTable(
  'purchase_lines',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    purchaseId: uuid('purchase_id')
      .notNull()
      .references(() => purchases.id, { onDelete: 'cascade' }),
    /** Producto del catálogo. Puede ir vacío: no todo lo que se compra se vende. */
    productId: uuid('product_id').references(() => products.id),
    description: text('description').notNull(),
    /** Cantidad en milésimas. */
    quantity: amount('quantity').notNull(),
    /** Costo unitario en la moneda de la compra. */
    unitCost: amount('unit_cost').notNull(),
    lineTotal: amount('line_total').notNull(),
    createdAt: createdAt(),
  },
  (table) => [index('purchase_lines_purchase_idx').on(table.purchaseId)],
)

/**
 * Pago a un proveedor contra una compra.
 *
 * El espejo de `receivable_entries`: cada abono guarda su importe en las dos
 * monedas con la tasa del día en que se pagó, así que una deuda en dólares
 * pagada en bolívares se reduce por lo que ese pago valía ESE día, no con la
 * tasa de hoy. El saldo por pagar sale de restar estos abonos al total.
 */
export const purchasePayments = pgTable(
  'purchase_payments',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    purchaseId: uuid('purchase_id')
      .notNull()
      .references(() => purchases.id, { onDelete: 'cascade' }),
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
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    createdAt: createdAt(),
  },
  (table) => [index('purchase_payments_purchase_idx').on(table.purchaseId)],
)

export const suppliersRelations = relations(suppliers, ({ one, many }) => ({
  tenant: one(tenants, { fields: [suppliers.tenantId], references: [tenants.id] }),
  purchases: many(purchases),
}))

export const purchasesRelations = relations(purchases, ({ one, many }) => ({
  supplier: one(suppliers, { fields: [purchases.supplierId], references: [suppliers.id] }),
  lines: many(purchaseLines),
  payments: many(purchasePayments),
}))

export const purchasePaymentsRelations = relations(purchasePayments, ({ one }) => ({
  purchase: one(purchases, { fields: [purchasePayments.purchaseId], references: [purchases.id] }),
}))

export const purchaseLinesRelations = relations(purchaseLines, ({ one }) => ({
  purchase: one(purchases, { fields: [purchaseLines.purchaseId], references: [purchases.id] }),
  product: one(products, { fields: [purchaseLines.productId], references: [products.id] }),
}))
