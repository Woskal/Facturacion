import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Database } from '@fve/db'
import {
  addReceivableEntry,
  adjustStock,
  archiveCustomer,
  archiveProduct,
  archiveSupplier,
  closeCashSession,
  createCustomer,
  createCreditNote,
  createExpense,
  createProduct,
  createPurchase,
  createSale,
  createSupplier,
  dailySales,
  expensesTotal,
  fetchBcvRate,
  customerHistory,
  getCashSessionSummary,
  getDocument,
  getIssuer,
  getOpenSession,
  getPurchase,
  getRateFor,
  listControlBooks,
  listExpenses,
  listPayables,
  listPriceLists,
  listPurchases,
  listRates,
  listRetentions,
  profitReport,
  registerPurchasePayment,
  listReceivables,
  listNumberBlocks,
  listStations,
  listTaxRates,
  lowStockProducts,
  openCashSession,
  releaseNumberBlock,
  reserveNumberBlock,
  searchCustomers,
  searchDocuments,
  searchSuppliers,
  salesBook,
  salesBookToCsv,
  salesByMethod,
  searchProducts,
  setControlRange,
  setProductPrice,
  setRate,
  syncBcvRate,
  toIsoDate,
  topProducts,
  updateCustomer,
  updateIssuer,
  updateProduct,
  updateSupplier,
  voidSale,
} from '@fve/core'

import {
  SaleTimestampError,
  currencySchema,
  isoDateSchema,
  moneySchema,
  quantitySchema,
  requireTenant,
} from '../http'

const paymentMethodSchema = z.enum([
  'EFECTIVO_BS',
  'EFECTIVO_USD',
  'PAGO_MOVIL',
  'TRANSFERENCIA_BS',
  'PUNTO_VENTA',
  'ZELLE',
  'USDT',
  'CREDITO',
])

const idKindSchema = z.enum(['V', 'E', 'J', 'G', 'P'])

const documentKindSchema = z.enum(['FACTURA', 'PRESUPUESTO', 'NOTA_ENTREGA', 'RECIBO', 'NOTA_CREDITO'])

/** Cuánto hacia atrás se admite fechar una venta sincronizada. */
const MAX_ATRASO_DIAS = 30

/**
 * Valida el momento que declara una venta hecha sin conexión.
 *
 * Dejar que el cliente fije la fecha de un documento fiscal es delicado: sirve
 * para antedatar ventas. Por eso solo se acepta junto a un número reservado
 * —prueba de que la caja estuvo realmente desconectada— y dentro de una ventana
 * razonable. Nunca hacia el futuro.
 */
function fechaDeVenta(occurredAt: string, reservedNumber: number | undefined): Date {
  if (reservedNumber === undefined) {
    throw new SaleTimestampError('Solo una venta con número reservado puede declarar su propio momento.')
  }

  const momento = new Date(occurredAt)
  const ahora = Date.now()

  if (momento.getTime() > ahora + 5 * 60 * 1000) {
    throw new SaleTimestampError('Una venta no puede estar fechada en el futuro.')
  }
  if (momento.getTime() < ahora - MAX_ATRASO_DIAS * 24 * 60 * 60 * 1000) {
    throw new SaleTimestampError(
      `Una venta no puede sincronizarse con más de ${MAX_ATRASO_DIAS} días de atraso. Regístrela a mano.`,
    )
  }

  return momento
}
const productParams = z.object({ productId: z.string().uuid() })

export function registerBusinessRoutes(app: FastifyInstance, db: Database): void {
  // --- Tasa del día ---------------------------------------------------------

  app.get('/rates/current', async (request, reply) => {
    const ctx = requireTenant(request)
    const rate = await getRateFor(db, ctx.activeTenantId, toIsoDate(new Date()))
    return reply.send({ rate: { bsPerUsd: rate.bsPerUsd, date: rate.date, source: rate.source, id: rate.id } })
  })

  app.get('/rates', async (request, reply) => {
    const ctx = requireTenant(request)
    const query = z.object({ limit: z.coerce.number().int().min(1).max(365).optional() }).parse(request.query)
    return reply.send({ rates: await listRates(db, ctx.activeTenantId, query.limit) })
  })

  /**
   * Carga o corrige la tasa de un día.
   *
   * Corregirla es normal —el BCV publica tarde, alguien la teclea mal— y no
   * reescribe nada: cada documento guarda copiada la tasa con que se calculó.
   */
  app.post('/rates', async (request, reply) => {
    const ctx = requireTenant(request)
    const body = z
      .object({
        value: z.string().min(1),
        effectiveOn: isoDateSchema.optional(),
        source: z.enum(['BCV', 'MANUAL', 'PARALELO']).optional(),
      })
      .parse(request.body)

    const rate = await setRate(db, {
      tenantId: ctx.activeTenantId,
      value: body.value,
      effectiveOn: body.effectiveOn ?? toIsoDate(new Date()),
      source: body.source,
      userId: ctx.userId,
    })

    return reply.status(201).send({ rate })
  })

  /**
   * Trae la tasa del BCV ahora mismo.
   *
   * La actualización periódica ya corre sola; esto es para cuando alguien quiere
   * la tasa nueva sin esperar al siguiente ciclo. Nunca pisa una tasa cargada a
   * mano para esa fecha.
   */
  app.post('/rates/sync', async (request, reply) => {
    const ctx = requireTenant(request)
    const quote = await fetchBcvRate()
    const result = await syncBcvRate(db, {
      tenantId: ctx.activeTenantId,
      quote,
      userId: ctx.userId,
    })
    return reply.send(result)
  })

  // --- Reportes -------------------------------------------------------------

  const rangoSchema = z.object({ from: isoDateSchema, to: isoDateSchema })

  /**
   * Libro de ventas del período.
   *
   * Sale de lo que quedó persistido en cada documento, nunca de un recálculo:
   * un libro recalculado con el código de hoy da un número distinto al que se
   * declaró.
   */
  app.get('/reports/sales-book', async (request, reply) => {
    const ctx = requireTenant(request)
    const rango = rangoSchema.parse(request.query)
    return reply.send({ book: await salesBook(db, { tenantId: ctx.activeTenantId, ...rango }) })
  })

  /** El mismo libro en CSV, para abrirlo en una hoja de cálculo. */
  app.get('/reports/sales-book.csv', async (request, reply) => {
    const ctx = requireTenant(request)
    const rango = rangoSchema.parse(request.query)
    const book = await salesBook(db, { tenantId: ctx.activeTenantId, ...rango })

    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="libro-de-ventas-${rango.from}-a-${rango.to}.csv"`)
      // Marca de orden de bytes para que Excel reconozca los acentos.
      .send('﻿' + salesBookToCsv(book))
  })

  app.get('/reports/daily-sales', async (request, reply) => {
    const ctx = requireTenant(request)
    const rango = rangoSchema.parse(request.query)
    return reply.send({ days: await dailySales(db, { tenantId: ctx.activeTenantId, ...rango }) })
  })

  app.get('/reports/by-method', async (request, reply) => {
    const ctx = requireTenant(request)
    const rango = rangoSchema.parse(request.query)
    return reply.send({ methods: await salesByMethod(db, { tenantId: ctx.activeTenantId, ...rango }) })
  })

  app.get('/reports/top-products', async (request, reply) => {
    const ctx = requireTenant(request)
    const rango = rangoSchema.parse(request.query)
    const query = z.object({ limit: z.coerce.number().int().min(1).max(100).optional() }).parse(request.query)
    return reply.send({
      products: await topProducts(db, { tenantId: ctx.activeTenantId, ...rango, limit: query.limit }),
    })
  })

  /** Ganancia del período: ventas menos costo de la mercancía vendida. */
  app.get('/reports/profit', async (request, reply) => {
    const ctx = requireTenant(request)
    const rango = rangoSchema.parse(request.query)
    const query = z.object({ limit: z.coerce.number().int().min(1).max(100).optional() }).parse(request.query)
    return reply.send({
      report: await profitReport(db, { tenantId: ctx.activeTenantId, ...rango, limit: query.limit }),
    })
  })

  /** Total de gastos del período, para restarlo a la ganancia bruta. */
  app.get('/reports/expenses-total', async (request, reply) => {
    const ctx = requireTenant(request)
    const rango = rangoSchema.parse(request.query)
    return reply.send({ total: await expensesTotal(db, { tenantId: ctx.activeTenantId, ...rango }) })
  })

  /** Retenciones que los clientes le aplicaron al negocio en el período. */
  app.get('/reports/retentions', async (request, reply) => {
    const ctx = requireTenant(request)
    const rango = rangoSchema.parse(request.query)
    return reply.send({ retentions: await listRetentions(db, { tenantId: ctx.activeTenantId, ...rango }) })
  })

  // --- Catálogo -------------------------------------------------------------

  app.get('/stations', async (request, reply) => {
    const ctx = requireTenant(request)
    return reply.send({ stations: await listStations(db, ctx.activeTenantId) })
  })

  // --- Bloques de numeración para operar sin conexión -----------------------

  const stationParams = z.object({ stationId: z.string().uuid() })

  /**
   * Aparta un bloque de consecutivos para una caja.
   *
   * La caja lo pide estando en línea y lo gasta sin internet. Los números salen
   * de la misma serie que usa la venta normal, así que una caja en línea y otra
   * sin conexión no pueden coincidir jamás.
   */
  app.post('/stations/:stationId/number-blocks', async (request, reply) => {
    const ctx = requireTenant(request)
    const params = stationParams.parse(request.params)
    const body = z
      .object({
        kind: z.enum(['PRESUPUESTO', 'NOTA_ENTREGA', 'RECIBO', 'NOTA_CREDITO']).default('NOTA_ENTREGA'),
        count: z.number().int().min(1).max(1000),
      })
      .parse(request.body)

    const block = await reserveNumberBlock(db, {
      tenantId: ctx.activeTenantId,
      stationId: params.stationId,
      userId: ctx.userId,
      ...body,
    })

    return reply.status(201).send({ block })
  })

  app.get('/stations/:stationId/number-blocks', async (request, reply) => {
    const ctx = requireTenant(request)
    const params = stationParams.parse(request.params)
    return reply.send({
      blocks: await listNumberBlocks(db, { tenantId: ctx.activeTenantId, stationId: params.stationId }),
    })
  })

  /** Libera lo que quede. Los números sin usar son un hueco, no vuelven a la serie. */
  app.delete('/number-blocks/:reservationId', async (request, reply) => {
    const ctx = requireTenant(request)
    const params = z.object({ reservationId: z.string().uuid() }).parse(request.params)
    await releaseNumberBlock(db, { tenantId: ctx.activeTenantId, reservationId: params.reservationId })
    return reply.status(204).send()
  })

  app.get('/tax-rates', async (request, reply) => {
    const ctx = requireTenant(request)
    return reply.send({ taxRates: await listTaxRates(db, ctx.activeTenantId) })
  })

  app.get('/products', async (request, reply) => {
    const ctx = requireTenant(request)
    const query = z
      .object({
        q: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
        priceListId: z.string().uuid().optional(),
      })
      .parse(request.query)

    return reply.send({
      products: await searchProducts(db, {
        tenantId: ctx.activeTenantId,
        query: query.q,
        limit: query.limit,
        priceListId: query.priceListId,
      }),
    })
  })

  app.get('/price-lists', async (request, reply) => {
    const ctx = requireTenant(request)
    return reply.send({ priceLists: await listPriceLists(db, ctx.activeTenantId) })
  })

  /** Fija el precio de un producto en una lista (p. ej. mayor). */
  app.post('/products/:productId/prices', async (request, reply) => {
    const ctx = requireTenant(request)
    const params = productParams.parse(request.params)
    const body = z.object({ priceListId: z.string().uuid(), price: moneySchema }).parse(request.body)

    await setProductPrice(db, { tenantId: ctx.activeTenantId, productId: params.productId, ...body })
    return reply.status(204).send()
  })

  app.get('/products/low-stock', async (request, reply) => {
    const ctx = requireTenant(request)
    return reply.send({ products: await lowStockProducts(db, ctx.activeTenantId) })
  })

  app.post('/products', async (request, reply) => {
    const ctx = requireTenant(request)
    const body = z
      .object({
        sku: z.string().min(1),
        name: z.string().min(1),
        taxRateId: z.string().uuid(),
        price: moneySchema,
        barcode: z.string().optional(),
        unit: z.string().optional(),
        priceMode: z.enum(['IVA_INCLUIDO', 'IVA_EXCLUIDO']).optional(),
        tracksStock: z.boolean().optional(),
        minStock: quantitySchema.optional(),
        initialStock: quantitySchema.optional(),
      })
      .parse(request.body)

    const created = await createProduct(db, { tenantId: ctx.activeTenantId, userId: ctx.userId, ...body })
    return reply.status(201).send(created)
  })

  app.patch('/products/:productId', async (request, reply) => {
    const ctx = requireTenant(request)
    const params = productParams.parse(request.params)
    const body = z
      .object({
        name: z.string().min(1).optional(),
        barcode: z.string().nullable().optional(),
        unit: z.string().optional(),
        taxRateId: z.string().uuid().optional(),
        priceMode: z.enum(['IVA_INCLUIDO', 'IVA_EXCLUIDO']).optional(),
        minStock: quantitySchema.optional(),
        price: moneySchema.optional(),
      })
      .parse(request.body)

    await updateProduct(db, { tenantId: ctx.activeTenantId, productId: params.productId, ...body })
    return reply.status(204).send()
  })

  app.delete('/products/:productId', async (request, reply) => {
    const ctx = requireTenant(request)
    const params = productParams.parse(request.params)
    await archiveProduct(db, { tenantId: ctx.activeTenantId, productId: params.productId })
    return reply.status(204).send()
  })

  /** Todo ajuste exige razón: sin rastro es como desaparece mercancía. */
  app.post('/products/:productId/adjust-stock', async (request, reply) => {
    const ctx = requireTenant(request)
    const params = productParams.parse(request.params)
    const body = z.object({ quantity: quantitySchema, reason: z.string().min(1) }).parse(request.body)

    await adjustStock(db, {
      tenantId: ctx.activeTenantId,
      userId: ctx.userId,
      productId: params.productId,
      ...body,
    })
    return reply.status(204).send()
  })

  // --- Clientes -------------------------------------------------------------

  app.get('/customers', async (request, reply) => {
    const ctx = requireTenant(request)
    const query = z
      .object({ q: z.string().optional(), limit: z.coerce.number().int().min(1).max(200).optional() })
      .parse(request.query)

    return reply.send({
      customers: await searchCustomers(db, { tenantId: ctx.activeTenantId, query: query.q, limit: query.limit }),
    })
  })

  app.post('/customers', async (request, reply) => {
    const ctx = requireTenant(request)
    const body = z
      .object({
        idKind: idKindSchema,
        idNumber: z.string().min(1),
        name: z.string().min(1),
        phone: z.string().optional(),
        email: z.string().email().optional(),
        address: z.string().optional(),
        specialTaxpayer: z.boolean().optional(),
        creditLimit: quantitySchema.optional(),
      })
      .parse(request.body)

    const created = await createCustomer(db, { tenantId: ctx.activeTenantId, ...body })
    return reply.status(201).send(created)
  })

  app.patch('/customers/:customerId', async (request, reply) => {
    const ctx = requireTenant(request)
    const params = z.object({ customerId: z.string().uuid() }).parse(request.params)
    const body = z
      .object({
        name: z.string().min(1).optional(),
        phone: z.string().nullable().optional(),
        email: z.string().email().nullable().optional(),
        address: z.string().nullable().optional(),
        specialTaxpayer: z.boolean().optional(),
        creditLimit: quantitySchema.optional(),
      })
      .parse(request.body)

    await updateCustomer(db, { tenantId: ctx.activeTenantId, customerId: params.customerId, ...body })
    return reply.status(204).send()
  })

  app.delete('/customers/:customerId', async (request, reply) => {
    const ctx = requireTenant(request)
    const params = z.object({ customerId: z.string().uuid() }).parse(request.params)
    await archiveCustomer(db, { tenantId: ctx.activeTenantId, customerId: params.customerId })
    return reply.status(204).send()
  })

  app.get('/customers/:customerId/history', async (request, reply) => {
    const ctx = requireTenant(request)
    const params = z.object({ customerId: z.string().uuid() }).parse(request.params)
    return reply.send({
      documents: await customerHistory(db, { tenantId: ctx.activeTenantId, customerId: params.customerId }),
    })
  })

  // --- Cartera --------------------------------------------------------------

  app.get('/receivables', async (request, reply) => {
    const ctx = requireTenant(request)
    const query = z
      .object({ customerId: z.string().uuid().optional(), includeSettled: z.coerce.boolean().optional() })
      .parse(request.query)

    return reply.send({
      receivables: await listReceivables(db, { tenantId: ctx.activeTenantId, ...query }),
    })
  })

  app.post('/receivables/:receivableId/entries', async (request, reply) => {
    const ctx = requireTenant(request)
    const params = z.object({ receivableId: z.string().uuid() }).parse(request.params)
    const body = z
      .object({
        kind: z.enum(['PAYMENT', 'RETENTION_IVA', 'RETENTION_ISLR', 'CREDIT_NOTE', 'WRITE_OFF']),
        amount: moneySchema,
        method: paymentMethodSchema.optional(),
        reference: z.string().optional(),
        retentionNumber: z.string().optional(),
      })
      .parse(request.body)

    const result = await addReceivableEntry(db, {
      tenantId: ctx.activeTenantId,
      userId: ctx.userId,
      receivableId: params.receivableId,
      ...body,
    })

    return reply.status(201).send(result)
  })

  // --- Ventas ---------------------------------------------------------------

  /**
   * Emite una venta.
   *
   * `clientRef` es la clave de idempotencia: reenviar la misma venta devuelve el
   * mismo documento en vez de emitir otro. Es lo que hace segura la
   * sincronización cuando la caja estuvo sin conexión.
   */
  app.post('/sales', async (request, reply) => {
    const ctx = requireTenant(request)
    const body = z
      .object({
        stationId: z.string().uuid(),
        currency: currencySchema,
        customerId: z.string().uuid().optional(),
        cashSessionId: z.string().uuid().optional(),
        kind: documentKindSchema.optional(),
        priceListId: z.string().uuid().optional(),
        changeCurrency: currencySchema.optional(),
        clientRef: z.string().min(1).max(120).optional(),
        reservedNumber: z.number().int().min(1).optional(),
        /**
         * Momento real de la venta, para lo que se emitió sin conexión.
         *
         * Sin esto, una venta de ayer sincronizada hoy quedaría fechada hoy y
         * calculada con la tasa de hoy: el libro de ventas diría algo que no
         * pasó.
         */
        occurredAt: z.string().datetime().optional(),
        notes: z.string().optional(),
        lines: z
          .array(
            z.object({
              productId: z.string().uuid().optional(),
              description: z.string().optional(),
              taxRateId: z.string().uuid().optional(),
              quantity: quantitySchema,
              unitPrice: moneySchema.optional(),
              discountBps: z.number().int().min(0).max(10000).optional(),
            }),
          )
          .min(1),
        payments: z.array(
          z.object({
            method: paymentMethodSchema,
            amount: moneySchema,
            reference: z.string().optional(),
          }),
        ),
      })
      .parse(request.body)

    const sale = await createSale(db, {
      tenantId: ctx.activeTenantId,
      userId: ctx.userId,
      ...body,
      ...(body.occurredAt !== undefined ? { now: fechaDeVenta(body.occurredAt, body.reservedNumber) } : {}),
    })

    return reply.status(sale.deduplicated ? 200 : 201).send({
      documentId: sale.documentId,
      fullNumber: sale.fullNumber,
      number: sale.number,
      currency: sale.currency,
      deduplicated: sale.deduplicated,
      totals: sale.totals,
      settlement: {
        totalDue: sale.settlement.totalDue,
        igtf: sale.settlement.igtf,
        change: sale.settlement.change,
        changeCurrency: sale.settlement.changeCurrency,
        credit: sale.settlement.credit,
      },
      rate: { bsPerUsd: sale.rate.bsPerUsd, date: sale.rate.date },
    })
  })

  /** Anular conserva la fila y el consecutivo. No borra. */
  app.post('/sales/:documentId/void', async (request, reply) => {
    const ctx = requireTenant(request)
    const params = z.object({ documentId: z.string().uuid() }).parse(request.params)
    const body = z.object({ reason: z.string().min(1) }).parse(request.body)

    await voidSale(db, {
      tenantId: ctx.activeTenantId,
      documentId: params.documentId,
      userId: ctx.userId,
      reason: body.reason,
    })

    return reply.status(204).send()
  })

  /** Emite una nota de crédito por la devolución total de un documento. */
  app.post('/sales/:documentId/credit-note', async (request, reply) => {
    const ctx = requireTenant(request)
    const params = z.object({ documentId: z.string().uuid() }).parse(request.params)
    const body = z.object({ reason: z.string().min(1) }).parse(request.body)

    const credito = await createCreditNote(db, {
      tenantId: ctx.activeTenantId,
      documentId: params.documentId,
      userId: ctx.userId,
      reason: body.reason,
    })

    return reply.status(201).send(credito)
  })

  // --- Documentos emitidos --------------------------------------------------

  /**
   * Busca entre lo emitido.
   *
   * Es la pantalla a la que uno va cuando un cliente pide copia de una factura:
   * busca por número, número de control y nombre del cliente a la vez.
   */
  app.get('/documents', async (request, reply) => {
    const ctx = requireTenant(request)
    const query = z
      .object({
        q: z.string().optional(),
        kind: documentKindSchema.optional(),
        status: z.enum(['ISSUED', 'VOIDED']).optional(),
        from: isoDateSchema.optional(),
        to: isoDateSchema.optional(),
        customerId: z.string().uuid().optional(),
        limit: z.coerce.number().int().min(1).max(500).optional(),
      })
      .parse(request.query)

    return reply.send({
      documents: await searchDocuments(db, { tenantId: ctx.activeTenantId, ...query }),
    })
  })

  /** Un documento completo, listo para ver o imprimir. Nada se recalcula. */
  app.get('/documents/:documentId', async (request, reply) => {
    const ctx = requireTenant(request)
    const params = z.object({ documentId: z.string().uuid() }).parse(request.params)
    return reply.send({
      document: await getDocument(db, { tenantId: ctx.activeTenantId, documentId: params.documentId }),
    })
  })

  // --- Datos del emisor (encabezado de los documentos) ----------------------

  app.get('/issuer', async (request, reply) => {
    const ctx = requireTenant(request)
    return reply.send({ issuer: await getIssuer(db, ctx.activeTenantId) })
  })

  app.patch('/issuer', async (request, reply) => {
    const ctx = requireTenant(request)
    const body = z
      .object({
        tradeName: z.string().nullable().optional(),
        legalName: z.string().nullable().optional(),
        address: z.string().nullable().optional(),
        city: z.string().nullable().optional(),
        phone: z.string().nullable().optional(),
        email: z.string().email().nullable().optional(),
        website: z.string().nullable().optional(),
        documentFooter: z.string().nullable().optional(),
      })
      .parse(request.body)

    await updateIssuer(db, { tenantId: ctx.activeTenantId, ...body })
    return reply.status(204).send()
  })

  // --- Talonarios de números de control -------------------------------------

  /** Estado de los talonarios. Avisa antes de quedarse sin papel para facturar. */
  app.get('/control-books', async (request, reply) => {
    const ctx = requireTenant(request)
    return reply.send({ books: await listControlBooks(db, ctx.activeTenantId) })
  })

  /**
   * Carga el rango de números de control de un talonario nuevo.
   *
   * Los números vienen preimpresos por la imprenta autorizada; el negocio dice
   * desde dónde hasta dónde va y el sistema los reparte en orden.
   */
  app.post('/control-books', async (request, reply) => {
    const ctx = requireTenant(request)
    const body = z
      .object({
        kind: documentKindSchema.default('FACTURA'),
        prefix: z.string().nullable().optional(),
        from: z.number().int().min(1),
        to: z.number().int().min(1),
      })
      .parse(request.body)

    await setControlRange(db, {
      tenantId: ctx.activeTenantId,
      kind: body.kind,
      prefix: body.prefix ?? null,
      from: body.from,
      to: body.to,
    })
    return reply.status(204).send()
  })

  // --- Proveedores ----------------------------------------------------------

  app.get('/suppliers', async (request, reply) => {
    const ctx = requireTenant(request)
    const query = z
      .object({ q: z.string().optional(), limit: z.coerce.number().int().min(1).max(200).optional() })
      .parse(request.query)
    return reply.send({
      suppliers: await searchSuppliers(db, { tenantId: ctx.activeTenantId, query: query.q, limit: query.limit }),
    })
  })

  app.post('/suppliers', async (request, reply) => {
    const ctx = requireTenant(request)
    const body = z
      .object({
        idKind: idKindSchema,
        idNumber: z.string().min(1),
        name: z.string().min(1),
        contactName: z.string().optional(),
        phone: z.string().optional(),
        email: z.string().email().optional(),
        address: z.string().optional(),
        notes: z.string().optional(),
      })
      .parse(request.body)

    const created = await createSupplier(db, { tenantId: ctx.activeTenantId, ...body })
    return reply.status(201).send(created)
  })

  app.patch('/suppliers/:supplierId', async (request, reply) => {
    const ctx = requireTenant(request)
    const params = z.object({ supplierId: z.string().uuid() }).parse(request.params)
    const body = z
      .object({
        name: z.string().min(1).optional(),
        contactName: z.string().nullable().optional(),
        phone: z.string().nullable().optional(),
        email: z.string().email().nullable().optional(),
        address: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
      })
      .parse(request.body)

    await updateSupplier(db, { tenantId: ctx.activeTenantId, supplierId: params.supplierId, ...body })
    return reply.status(204).send()
  })

  app.delete('/suppliers/:supplierId', async (request, reply) => {
    const ctx = requireTenant(request)
    const params = z.object({ supplierId: z.string().uuid() }).parse(request.params)
    await archiveSupplier(db, { tenantId: ctx.activeTenantId, supplierId: params.supplierId })
    return reply.status(204).send()
  })

  // --- Compras --------------------------------------------------------------

  app.get('/purchases', async (request, reply) => {
    const ctx = requireTenant(request)
    const query = z
      .object({
        supplierId: z.string().uuid().optional(),
        from: isoDateSchema.optional(),
        to: isoDateSchema.optional(),
        limit: z.coerce.number().int().min(1).max(500).optional(),
      })
      .parse(request.query)
    return reply.send({ purchases: await listPurchases(db, { tenantId: ctx.activeTenantId, ...query }) })
  })

  app.get('/purchases/:purchaseId', async (request, reply) => {
    const ctx = requireTenant(request)
    const params = z.object({ purchaseId: z.string().uuid() }).parse(request.params)
    return reply.send({
      purchase: await getPurchase(db, { tenantId: ctx.activeTenantId, purchaseId: params.purchaseId }),
    })
  })

  /**
   * Registra una compra.
   *
   * Los totales se copian de la factura del proveedor; el IVA va tal como él lo
   * cobró. Cada renglón con un producto que lleva inventario suma existencia.
   */
  app.post('/purchases', async (request, reply) => {
    const ctx = requireTenant(request)
    const body = z
      .object({
        supplierId: z.string().uuid(),
        invoiceNumber: z.string().min(1),
        controlNumber: z.string().optional(),
        currency: currencySchema,
        iva: moneySchema,
        paidNow: moneySchema.optional(),
        paidMethod: paymentMethodSchema.optional(),
        notes: z.string().optional(),
        lines: z
          .array(
            z.object({
              productId: z.string().uuid().optional(),
              description: z.string().min(1),
              quantity: quantitySchema,
              unitCost: moneySchema,
            }),
          )
          .min(1),
      })
      .parse(request.body)

    const created = await createPurchase(db, { tenantId: ctx.activeTenantId, userId: ctx.userId, ...body })
    return reply.status(201).send(created)
  })

  // --- Cuentas por pagar ----------------------------------------------------

  app.get('/payables', async (request, reply) => {
    const ctx = requireTenant(request)
    const query = z
      .object({ supplierId: z.string().uuid().optional(), includeSettled: z.coerce.boolean().optional() })
      .parse(request.query)
    return reply.send({ payables: await listPayables(db, { tenantId: ctx.activeTenantId, ...query }) })
  })

  app.post('/purchases/:purchaseId/payments', async (request, reply) => {
    const ctx = requireTenant(request)
    const params = z.object({ purchaseId: z.string().uuid() }).parse(request.params)
    const body = z
      .object({ amount: moneySchema, method: paymentMethodSchema.optional(), reference: z.string().optional() })
      .parse(request.body)

    const result = await registerPurchasePayment(db, {
      tenantId: ctx.activeTenantId,
      userId: ctx.userId,
      purchaseId: params.purchaseId,
      ...body,
    })
    return reply.status(201).send(result)
  })

  // --- Gastos ---------------------------------------------------------------

  app.get('/expenses', async (request, reply) => {
    const ctx = requireTenant(request)
    const query = z
      .object({
        from: isoDateSchema.optional(),
        to: isoDateSchema.optional(),
        limit: z.coerce.number().int().min(1).max(500).optional(),
      })
      .parse(request.query)
    return reply.send({ expenses: await listExpenses(db, { tenantId: ctx.activeTenantId, ...query }) })
  })

  app.post('/expenses', async (request, reply) => {
    const ctx = requireTenant(request)
    const body = z
      .object({
        categoryName: z.string().optional(),
        description: z.string().min(1),
        currency: currencySchema,
        amount: moneySchema,
        paidWith: paymentMethodSchema.optional(),
        reference: z.string().optional(),
      })
      .parse(request.body)

    const created = await createExpense(db, { tenantId: ctx.activeTenantId, userId: ctx.userId, ...body })
    return reply.status(201).send(created)
  })

  // --- Caja -----------------------------------------------------------------

  const countLinesSchema = z.array(
    z.object({ method: paymentMethodSchema, currency: currencySchema, amount: quantitySchema }),
  )

  app.post('/cash/open', async (request, reply) => {
    const ctx = requireTenant(request)
    const body = z
      .object({ stationId: z.string().uuid(), opening: countLinesSchema.optional() })
      .parse(request.body)

    const opened = await openCashSession(db, {
      tenantId: ctx.activeTenantId,
      userId: ctx.userId,
      ...body,
    })

    return reply.status(201).send(opened)
  })

  app.get('/cash/current', async (request, reply) => {
    const ctx = requireTenant(request)
    const query = z.object({ stationId: z.string().uuid() }).parse(request.query)
    const open = await getOpenSession(db, ctx.activeTenantId, query.stationId)
    if (!open) return reply.send({ session: null })
    return reply.send({ session: await getCashSessionSummary(db, ctx.activeTenantId, open.sessionId) })
  })

  app.get('/cash/:sessionId', async (request, reply) => {
    const ctx = requireTenant(request)
    const params = z.object({ sessionId: z.string().uuid() }).parse(request.params)
    return reply.send({ session: await getCashSessionSummary(db, ctx.activeTenantId, params.sessionId) })
  })

  app.post('/cash/:sessionId/close', async (request, reply) => {
    const ctx = requireTenant(request)
    const params = z.object({ sessionId: z.string().uuid() }).parse(request.params)
    const body = z.object({ counted: countLinesSchema, notes: z.string().optional() }).parse(request.body)

    const summary = await closeCashSession(db, {
      tenantId: ctx.activeTenantId,
      userId: ctx.userId,
      sessionId: params.sessionId,
      ...body,
    })

    return reply.send({ session: summary })
  })
}
