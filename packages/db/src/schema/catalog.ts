import { relations, sql } from 'drizzle-orm'
import { boolean, date, index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

import { amount, archivedAt, createdAt, primaryId, rateScaled, updatedAt } from './columns'
import { currency, idKind, priceMode, rateSource } from './enums'
import { tenants, users } from './tenancy'

/**
 * Tasa de cambio vigente por día.
 *
 * Es tabla propia y con histórico porque cada documento guarda de qué fila salió
 * su tasa. Un reporte de enero se reconstruye con la tasa de enero; recalcularlo
 * con la de hoy daría un número que nunca existió.
 */
export const exchangeRates = pgTable(
  'exchange_rates',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Bolívares por dólar, escalados 1e8. */
    bsPerUsd: rateScaled('bs_per_usd').notNull(),
    effectiveOn: date('effective_on').notNull(),
    source: rateSource('source').notNull().default('BCV'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex('exchange_rates_tenant_date_unique').on(table.tenantId, table.effectiveOn)],
)

/**
 * Alícuotas de IVA del negocio.
 *
 * Es una tabla y no una constante porque las alícuotas cambian por decreto. La
 * suntuaria se guarda desglosada — 16% principal más 15% adicional — porque el
 * libro de ventas las pide separadas y rearmarlas después es imposible.
 */
export const taxRates = pgTable(
  'tax_rates',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    baseBps: integer('base_bps').notNull(),
    adicionalBps: integer('adicional_bps').notNull().default(0),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  (table) => [uniqueIndex('tax_rates_tenant_code_unique').on(table.tenantId, table.code)],
)

/**
 * Lista de precios. El MVP crea una sola por negocio.
 *
 * Existe desde ahora para que el precio del producto sea una relación y no una
 * columna suelta: agregar precios de mayor o especiales por cliente más adelante
 * no obligará a migrar ventas ya emitidas.
 */
export const priceLists = pgTable(
  'price_lists',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  (table) => [uniqueIndex('price_lists_tenant_name_unique').on(table.tenantId, table.name)],
)

export const products = pgTable(
  'products',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    sku: text('sku').notNull(),
    barcode: text('barcode'),
    name: text('name').notNull(),
    /** Unidad de venta: UND, KG, LT, MTS. */
    unit: text('unit').notNull().default('UND'),
    taxRateId: uuid('tax_rate_id')
      .notNull()
      .references(() => taxRates.id),
    priceMode: priceMode('price_mode').notNull().default('IVA_INCLUIDO'),
    /** Si descuenta inventario. Un servicio no lo hace. */
    tracksStock: boolean('tracks_stock').notNull().default(true),
    /** Existencia mínima, en milésimas. Dispara la alerta de reposición. */
    minStock: amount('min_stock').notNull().default(sql`0`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  (table) => [
    uniqueIndex('products_tenant_sku_unique').on(table.tenantId, table.sku),
    index('products_tenant_barcode_idx').on(table.tenantId, table.barcode),
    index('products_tenant_name_idx').on(table.tenantId, table.name),
  ],
)

/**
 * Precio de un producto en una lista.
 *
 * El precio se ancla en una moneda concreta: el negocio decide si su catálogo
 * está en dólares —lo habitual— o en bolívares. El precio en la otra moneda se
 * calcula con la tasa del día al momento de vender, nunca se guarda desfasado.
 */
export const productPrices = pgTable(
  'product_prices',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    priceListId: uuid('price_list_id')
      .notNull()
      .references(() => priceLists.id, { onDelete: 'cascade' }),
    currency: currency('currency').notNull(),
    unitPrice: amount('unit_price').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex('product_prices_product_list_unique').on(table.productId, table.priceListId)],
)

export const customers = pgTable(
  'customers',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Cédula o RIF: la letra y el número van separados para poder validar. */
    idKind: idKind('id_kind').notNull(),
    idNumber: text('id_number').notNull(),
    name: text('name').notNull(),
    phone: text('phone'),
    email: text('email'),
    address: text('address'),
    /** Si retiene IVA al pagar. Cambia cómo se salda su cuenta por cobrar. */
    specialTaxpayer: boolean('special_taxpayer').notNull().default(false),
    /** Límite de crédito en la moneda de anclaje del negocio. Cero = sin crédito. */
    creditLimit: amount('credit_limit').notNull().default(sql`0`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  (table) => [
    uniqueIndex('customers_tenant_id_unique').on(table.tenantId, table.idKind, table.idNumber),
    index('customers_tenant_name_idx').on(table.tenantId, table.name),
  ],
)

export const productsRelations = relations(products, ({ one, many }) => ({
  tenant: one(tenants, { fields: [products.tenantId], references: [tenants.id] }),
  taxRate: one(taxRates, { fields: [products.taxRateId], references: [taxRates.id] }),
  prices: many(productPrices),
}))

export const productPricesRelations = relations(productPrices, ({ one }) => ({
  product: one(products, { fields: [productPrices.productId], references: [products.id] }),
  priceList: one(priceLists, { fields: [productPrices.priceListId], references: [priceLists.id] }),
}))

export const customersRelations = relations(customers, ({ one }) => ({
  tenant: one(tenants, { fields: [customers.tenantId], references: [tenants.id] }),
}))
