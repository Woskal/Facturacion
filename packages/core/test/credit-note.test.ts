import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { schema, withTenant, type Database } from '@fve/db'
import { usd, ves } from '@fve/money'

import {
  AlreadyCreditedError,
  createCreditNote,
  createSale,
  dailySales,
  listReceivables,
  setRate,
} from '../src/index'
import { connect, resetDatabase, seedNegocio, stockOf, type Negocio } from './helpers'

const HOY = '2026-08-28'
const AHORA = new Date('2026-08-28T12:00:00')
const TASA = '36,5842'

let db: Database
let close: () => Promise<void>
let negocio: Negocio

beforeAll(() => {
  const connection = connect()
  db = connection.db
  close = connection.close
})

afterAll(async () => {
  await close?.()
})

beforeEach(async () => {
  await resetDatabase(db)
  negocio = await seedNegocio(db)
  await setRate(db, { tenantId: negocio.tenantId, value: TASA, effectiveOn: HOY, userId: negocio.userId })
  // seedNegocio solo crea la serie de nota de entrega; la nota de crédito usa la suya.
  await withTenant(db, negocio.tenantId, (tx) =>
    tx
      .insert(schema.documentSeries)
      .values({ tenantId: negocio.tenantId, kind: 'NOTA_CREDITO', prefix: 'NC', nextNumber: 1 }),
  )
})

describe('nota de crédito', () => {
  it('acredita en negativo, devuelve inventario y deja las ventas netas en cero', async () => {
    const antes = await stockOf(db, negocio.tenantId, negocio.harina)

    const venta = await createSale(db, {
      tenantId: negocio.tenantId,
      stationId: negocio.stationId,
      userId: negocio.userId,
      currency: 'USD',
      lines: [{ productId: negocio.harina, quantity: 2000n }],
      payments: [{ method: 'EFECTIVO_BS', amount: ves(10975n) }],
      now: AHORA,
    })

    // Vendidas 2 harinas: el inventario bajó.
    expect((await stockOf(db, negocio.tenantId, negocio.harina)) - antes).toBe(-2000n)

    const credito = await createCreditNote(db, {
      tenantId: negocio.tenantId,
      documentId: venta.documentId,
      userId: negocio.userId,
      reason: 'Devolución del cliente',
      now: AHORA,
    })
    expect(credito.fullNumber).toBe('NC-000001')

    const [doc] = await withTenant(db, negocio.tenantId, (tx) =>
      tx.select().from(schema.documents).where(eq(schema.documents.id, credito.documentId)),
    )
    expect(doc?.kind).toBe('NOTA_CREDITO')
    expect(doc?.status).toBe('ISSUED')
    expect(doc?.relatedDocumentId).toBe(venta.documentId)
    // Importes en negativo.
    expect(doc?.grandTotalUsd).toBe(-300n)

    // El inventario volvió a lo que era: la devolución repone lo vendido.
    expect(await stockOf(db, negocio.tenantId, negocio.harina)).toBe(antes)

    // Las ventas del día se netean a cero: venta (+) y nota de crédito (−).
    const dias = await dailySales(db, { tenantId: negocio.tenantId, from: HOY, to: HOY })
    const totalDia = dias.reduce((acc, d) => acc + d.totalVes.amount, 0n)
    expect(totalDia).toBe(0n)
    // Pero siguen siendo dos documentos en la numeración.
    expect(dias.reduce((acc, d) => acc + d.documents, 0)).toBe(2)
  })

  it('no se puede acreditar dos veces el mismo documento', async () => {
    const venta = await createSale(db, {
      tenantId: negocio.tenantId,
      stationId: negocio.stationId,
      userId: negocio.userId,
      currency: 'USD',
      lines: [{ productId: negocio.harina, quantity: 1000n }],
      payments: [{ method: 'EFECTIVO_BS', amount: ves(6000n) }],
      now: AHORA,
    })

    await createCreditNote(db, {
      tenantId: negocio.tenantId,
      documentId: venta.documentId,
      userId: negocio.userId,
      reason: 'x',
    })

    await expect(
      createCreditNote(db, {
        tenantId: negocio.tenantId,
        documentId: venta.documentId,
        userId: negocio.userId,
        reason: 'otra vez',
      }),
    ).rejects.toThrow(AlreadyCreditedError)
  })

  it('salda la cuenta por cobrar de una venta a crédito', async () => {
    const venta = await createSale(db, {
      tenantId: negocio.tenantId,
      stationId: negocio.stationId,
      userId: negocio.userId,
      currency: 'USD',
      customerId: negocio.customerId,
      lines: [{ productId: negocio.harina, quantity: 2000n }],
      payments: [{ method: 'CREDITO', amount: usd(300n) }], // toda a crédito
      now: AHORA,
    })

    let cartera = await listReceivables(db, { tenantId: negocio.tenantId })
    expect(cartera).toHaveLength(1)
    expect(cartera[0]?.balance.amount).toBe(300n)

    await createCreditNote(db, {
      tenantId: negocio.tenantId,
      documentId: venta.documentId,
      userId: negocio.userId,
      reason: 'Devolución',
    })

    // La cuenta quedó saldada: ya no aparece pendiente.
    cartera = await listReceivables(db, { tenantId: negocio.tenantId })
    expect(cartera).toHaveLength(0)
  })
})
