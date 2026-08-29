import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Database } from '@fve/db'
import {
  addReceivableEntry,
  adjustStock,
  archiveCustomer,
  archiveProduct,
  closeCashSession,
  createCustomer,
  createProduct,
  createSale,
  dailySales,
  fetchBcvRate,
  customerHistory,
  getCashSessionSummary,
  getOpenSession,
  getRateFor,
  listRates,
  listReceivables,
  listStations,
  listTaxRates,
  lowStockProducts,
  openCashSession,
  searchCustomers,
  salesBook,
  salesBookToCsv,
  salesByMethod,
  searchProducts,
  setRate,
  syncBcvRate,
  toIsoDate,
  topProducts,
  updateCustomer,
  updateProduct,
  voidSale,
} from '@fve/core'

import { currencySchema, isoDateSchema, moneySchema, quantitySchema, requireTenant } from '../http'

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

  // --- Catálogo -------------------------------------------------------------

  app.get('/stations', async (request, reply) => {
    const ctx = requireTenant(request)
    return reply.send({ stations: await listStations(db, ctx.activeTenantId) })
  })

  app.get('/tax-rates', async (request, reply) => {
    const ctx = requireTenant(request)
    return reply.send({ taxRates: await listTaxRates(db, ctx.activeTenantId) })
  })

  app.get('/products', async (request, reply) => {
    const ctx = requireTenant(request)
    const query = z
      .object({ q: z.string().optional(), limit: z.coerce.number().int().min(1).max(200).optional() })
      .parse(request.query)

    return reply.send({
      products: await searchProducts(db, {
        tenantId: ctx.activeTenantId,
        query: query.q,
        limit: query.limit,
      }),
    })
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
        kind: z.enum(['PRESUPUESTO', 'NOTA_ENTREGA', 'RECIBO', 'NOTA_CREDITO']).optional(),
        changeCurrency: currencySchema.optional(),
        clientRef: z.string().min(1).max(120).optional(),
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
