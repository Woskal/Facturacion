import { relations, sql } from 'drizzle-orm'
import {
  boolean,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'

import { amount, createdAt, primaryId, rateScaled, updatedAt } from './columns'
import { currency, documentKind, documentStatus, paymentMethod, priceMode } from './enums'
import { customers, exchangeRates, products, taxRates } from './catalog'
import { cashSessions } from './cash'
import { stations, tenants, users } from './tenancy'

/**
 * Serie de numeración. El consecutivo vive aquí, no en la tabla de documentos.
 */
export const documentSeries = pgTable(
  'document_series',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Serie propia de una caja, o compartida si va nula. */
    stationId: uuid('station_id').references(() => stations.id),
    kind: documentKind('kind').notNull(),
    prefix: text('prefix').notNull(),
    nextNumber: integer('next_number').notNull().default(1),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex('document_series_unique').on(table.tenantId, table.kind, table.prefix)],
)

/**
 * Bloque de consecutivos reservado para una estación.
 *
 * Es lo que permite vender sin conexión sin que dos cajas emitan el mismo
 * número: la caja pide un bloque estando en línea y lo va consumiendo offline.
 * Un bloque nunca se reutiliza — si sobran números, se liberan y quedan como
 * hueco justificado, que es preferible a un consecutivo duplicado.
 */
export const numberReservations = pgTable(
  'number_reservations',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    seriesId: uuid('series_id')
      .notNull()
      .references(() => documentSeries.id, { onDelete: 'cascade' }),
    stationId: uuid('station_id')
      .notNull()
      .references(() => stations.id, { onDelete: 'cascade' }),
    fromNumber: integer('from_number').notNull(),
    toNumber: integer('to_number').notNull(),
    /** Último número efectivamente usado. Nulo si el bloque no se ha estrenado. */
    consumedUpTo: integer('consumed_up_to'),
    reservedAt: createdAt(),
    releasedAt: timestamp('released_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('number_reservations_series_from_unique').on(table.seriesId, table.fromNumber),
    index('number_reservations_station_idx').on(table.stationId),
  ],
)

/**
 * Un documento emitido.
 *
 * **Inmutable.** Una vez en `ISSUED` no se edita ni se borra: se anula o se
 * corrige con una nota de crédito. Esa regla no está aquí por gusto — es la
 * precondición técnica para homologarse ante el SENIAT más adelante, y sale
 * gratis ahora frente a lo que costaría después.
 *
 * La tasa se guarda **denormalizada** además de referenciada: si alguien
 * corrigiera la fila de tasa del día, los documentos ya emitidos deben seguir
 * mostrando exactamente lo que se imprimió.
 *
 * Los totales van en las dos monedas porque el libro de ventas se lleva en
 * bolívares aunque el negocio facture en dólares. Las líneas, en cambio, van
 * solo en la moneda del documento: son detalle interno y se reconstruyen con la
 * tasa que el propio documento guarda.
 */
export const documents = pgTable(
  'documents',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    kind: documentKind('kind').notNull(),
    seriesId: uuid('series_id')
      .notNull()
      .references(() => documentSeries.id),
    number: integer('number').notNull(),
    /** Número presentable, por ejemplo `NE-000123`. */
    fullNumber: text('full_number').notNull(),
    /** Número de control de la imprenta o la máquina fiscal, cuando aplica. */
    controlNumber: text('control_number'),

    stationId: uuid('station_id')
      .notNull()
      .references(() => stations.id),
    /**
     * Turno de caja al que pertenece la venta.
     *
     * Es un vínculo explícito y no una deducción por ventana de tiempo: cuadrar
     * el arqueo mirando `issued_at` entre apertura y cierre falla justo en los
     * bordes, que es cuando más importa.
     */
    cashSessionId: uuid('cash_session_id').references(() => cashSessions.id),
    issuedByUserId: uuid('issued_by_user_id')
      .notNull()
      .references(() => users.id),
    customerId: uuid('customer_id').references(() => customers.id),
    /** Documento afectado por una nota de crédito. */
    relatedDocumentId: uuid('related_document_id').references((): AnyPgColumn => documents.id),

    status: documentStatus('status').notNull().default('DRAFT'),
    issuedAt: timestamp('issued_at', { withTimezone: true }),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidReason: text('void_reason'),

    currency: currency('currency').notNull(),
    exchangeRateId: uuid('exchange_rate_id')
      .notNull()
      .references(() => exchangeRates.id),
    rateBsPerUsd: rateScaled('rate_bs_per_usd').notNull(),
    rateEffectiveOn: date('rate_effective_on').notNull(),

    grossUsd: amount('gross_usd').notNull().default(sql`0`),
    grossVes: amount('gross_ves').notNull().default(sql`0`),
    discountUsd: amount('discount_usd').notNull().default(sql`0`),
    discountVes: amount('discount_ves').notNull().default(sql`0`),
    taxableBaseUsd: amount('taxable_base_usd').notNull().default(sql`0`),
    taxableBaseVes: amount('taxable_base_ves').notNull().default(sql`0`),
    exemptBaseUsd: amount('exempt_base_usd').notNull().default(sql`0`),
    exemptBaseVes: amount('exempt_base_ves').notNull().default(sql`0`),
    ivaBaseUsd: amount('iva_base_usd').notNull().default(sql`0`),
    ivaBaseVes: amount('iva_base_ves').notNull().default(sql`0`),
    ivaAdicionalUsd: amount('iva_adicional_usd').notNull().default(sql`0`),
    ivaAdicionalVes: amount('iva_adicional_ves').notNull().default(sql`0`),
    /** Total del documento con IVA, sin IGTF. */
    totalUsd: amount('total_usd').notNull().default(sql`0`),
    totalVes: amount('total_ves').notNull().default(sql`0`),
    igtfUsd: amount('igtf_usd').notNull().default(sql`0`),
    igtfVes: amount('igtf_ves').notNull().default(sql`0`),
    /** Total cobrado: documento más IGTF. */
    grandTotalUsd: amount('grand_total_usd').notNull().default(sql`0`),
    grandTotalVes: amount('grand_total_ves').notNull().default(sql`0`),

    /**
     * Vuelto entregado. Sale del efectivo, así que sin esto el arqueo nunca
     * cuadra: la caja tendría siempre de menos y parecería un faltante.
     */
    changeAmount: amount('change_amount').notNull().default(sql`0`),
    changeCurrency: currency('change_currency'),

    notes: text('notes'),
    /**
     * Identificador que asigna la caja al crear la venta, incluso sin conexión.
     * Es la clave de idempotencia de la sincronización: reenviar la misma venta
     * dos veces no puede producir dos documentos.
     */
    clientRef: text('client_ref'),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('documents_series_number_unique').on(table.seriesId, table.number),
    uniqueIndex('documents_tenant_client_ref_unique').on(table.tenantId, table.clientRef),
    index('documents_tenant_issued_idx').on(table.tenantId, table.issuedAt),
    index('documents_tenant_customer_idx').on(table.tenantId, table.customerId),
    index('documents_tenant_status_idx').on(table.tenantId, table.status),
  ],
)

/**
 * Línea de documento.
 *
 * La descripción, el precio y la alícuota se guardan copiados, no solo
 * referenciados: si el producto cambia de nombre o el decreto cambia el IVA, el
 * documento tiene que seguir diciendo lo que decía el día que se imprimió.
 */
export const documentLines = pgTable(
  'document_lines',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    lineNumber: integer('line_number').notNull(),

    productId: uuid('product_id').references(() => products.id),
    sku: text('sku'),
    description: text('description').notNull(),
    unit: text('unit').notNull().default('UND'),

    /** Cantidad en milésimas: 1500 son 1,5 unidades. */
    quantity: amount('quantity').notNull(),
    unitPrice: amount('unit_price').notNull(),
    discountBps: integer('discount_bps').notNull().default(0),
    priceMode: priceMode('price_mode').notNull(),

    taxRateId: uuid('tax_rate_id').references(() => taxRates.id),
    taxCode: text('tax_code').notNull(),
    taxBaseBps: integer('tax_base_bps').notNull(),
    taxAdicionalBps: integer('tax_adicional_bps').notNull().default(0),

    /** Importes en la moneda del documento. */
    gross: amount('gross').notNull(),
    discount: amount('discount').notNull().default(sql`0`),
    base: amount('base').notNull(),
    ivaBase: amount('iva_base').notNull().default(sql`0`),
    ivaAdicional: amount('iva_adicional').notNull().default(sql`0`),
    total: amount('total').notNull(),

    createdAt: createdAt(),
  },
  (table) => [uniqueIndex('document_lines_document_line_unique').on(table.documentId, table.lineNumber)],
)

/**
 * Desglose de impuestos por alícuota, persistido con el documento.
 *
 * No se recalcula al consultar. Recalcularlo años después, con otro código o con
 * alícuotas ya cambiadas, daría un número distinto al que se imprimió y al que
 * se declaró. Esta tabla es la fuente del libro de ventas.
 */
export const documentTaxBreakdown = pgTable(
  'document_tax_breakdown',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    taxCode: text('tax_code').notNull(),
    baseBps: integer('base_bps').notNull(),
    adicionalBps: integer('adicional_bps').notNull().default(0),

    baseUsd: amount('base_usd').notNull(),
    baseVes: amount('base_ves').notNull(),
    ivaBaseUsd: amount('iva_base_usd').notNull(),
    ivaBaseVes: amount('iva_base_ves').notNull(),
    ivaAdicionalUsd: amount('iva_adicional_usd').notNull().default(sql`0`),
    ivaAdicionalVes: amount('iva_adicional_ves').notNull().default(sql`0`),

    createdAt: createdAt(),
  },
  (table) => [uniqueIndex('document_tax_breakdown_unique').on(table.documentId, table.taxCode)],
)

/**
 * Un pago aplicado a un documento.
 *
 * Se guarda el monto tal como se recibió —en su propia moneda— y también
 * convertido a las dos monedas con la tasa del documento. Lo primero es la
 * verdad de lo que entró a la caja; lo segundo es lo que hace posible el arqueo
 * y el reporte sin volver a convertir nada.
 */
export const documentPayments = pgTable(
  'document_payments',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    method: paymentMethod('method').notNull(),
    currency: currency('currency').notNull(),
    amount: amount('amount').notNull(),
    amountUsd: amount('amount_usd').notNull(),
    amountVes: amount('amount_ves').notNull(),
    /** Si el medio activó percepción de IGTF. Copiado al momento del cobro. */
    isDivisa: boolean('is_divisa').notNull().default(false),
    reference: text('reference'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (table) => [index('document_payments_document_idx').on(table.documentId)],
)

export const documentsRelations = relations(documents, ({ one, many }) => ({
  tenant: one(tenants, { fields: [documents.tenantId], references: [tenants.id] }),
  series: one(documentSeries, { fields: [documents.seriesId], references: [documentSeries.id] }),
  station: one(stations, { fields: [documents.stationId], references: [stations.id] }),
  customer: one(customers, { fields: [documents.customerId], references: [customers.id] }),
  issuedBy: one(users, { fields: [documents.issuedByUserId], references: [users.id] }),
  exchangeRate: one(exchangeRates, { fields: [documents.exchangeRateId], references: [exchangeRates.id] }),
  lines: many(documentLines),
  taxBreakdown: many(documentTaxBreakdown),
  payments: many(documentPayments),
}))

export const documentLinesRelations = relations(documentLines, ({ one }) => ({
  document: one(documents, { fields: [documentLines.documentId], references: [documents.id] }),
  product: one(products, { fields: [documentLines.productId], references: [products.id] }),
}))

export const documentTaxBreakdownRelations = relations(documentTaxBreakdown, ({ one }) => ({
  document: one(documents, { fields: [documentTaxBreakdown.documentId], references: [documents.id] }),
}))

export const documentPaymentsRelations = relations(documentPayments, ({ one }) => ({
  document: one(documents, { fields: [documentPayments.documentId], references: [documents.id] }),
}))

export const documentSeriesRelations = relations(documentSeries, ({ one, many }) => ({
  tenant: one(tenants, { fields: [documentSeries.tenantId], references: [tenants.id] }),
  station: one(stations, { fields: [documentSeries.stationId], references: [stations.id] }),
  reservations: many(numberReservations),
}))

export const numberReservationsRelations = relations(numberReservations, ({ one }) => ({
  series: one(documentSeries, { fields: [numberReservations.seriesId], references: [documentSeries.id] }),
  station: one(stations, { fields: [numberReservations.stationId], references: [stations.id] }),
}))
