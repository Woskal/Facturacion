import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { schema, withTenant, type Database } from '@fve/db'
import { ves } from '@fve/money'

import {
  createSale,
  getDocument,
  listControlBooks,
  searchDocuments,
  setControlRange,
  setRate,
} from '../src/index'
import { connect, resetDatabase, seedNegocio, type Negocio } from './helpers'

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
  // seedNegocio solo crea la serie de nota de entrega; la factura necesita la suya.
  await withTenant(db, negocio.tenantId, (tx) =>
    tx
      .insert(schema.documentSeries)
      .values({ tenantId: negocio.tenantId, kind: 'FACTURA', prefix: 'F', nextNumber: 1 }),
  )
})

/** Emite una factura de dos harinas ($3,00) pagada en bolívares exactos. */
function emitirFactura() {
  return createSale(db, {
    tenantId: negocio.tenantId,
    stationId: negocio.stationId,
    userId: negocio.userId,
    kind: 'FACTURA',
    currency: 'USD',
    lines: [{ productId: negocio.harina, quantity: 2000n }],
    payments: [{ method: 'EFECTIVO_BS', amount: ves(10975n) }],
    now: AHORA,
  })
}

describe('número de control del talonario', () => {
  it('asigna el número de control en orden cuando hay talonario cargado', async () => {
    await setControlRange(db, { tenantId: negocio.tenantId, kind: 'FACTURA', prefix: '00-', from: 1, to: 10 })

    const venta = await emitirFactura()
    const doc = await getDocument(db, { tenantId: negocio.tenantId, documentId: venta.documentId })

    expect(venta.fullNumber).toBe('F-000001')
    expect(doc.controlNumber).toBe('00-00000001')
  })

  it('los números de control salen consecutivos', async () => {
    await setControlRange(db, { tenantId: negocio.tenantId, kind: 'FACTURA', prefix: '00-', from: 1, to: 10 })

    const primera = await emitirFactura()
    const segunda = await emitirFactura()

    const doc1 = await getDocument(db, { tenantId: negocio.tenantId, documentId: primera.documentId })
    const doc2 = await getDocument(db, { tenantId: negocio.tenantId, documentId: segunda.documentId })

    expect(doc1.controlNumber).toBe('00-00000001')
    expect(doc2.controlNumber).toBe('00-00000002')
  })

  it('agotado el talonario, la factura sale sin control pero la venta NO se detiene', async () => {
    // Rango de un solo número: la segunda factura ya no tiene de dónde sacarlo.
    await setControlRange(db, { tenantId: negocio.tenantId, kind: 'FACTURA', prefix: '00-', from: 1, to: 1 })

    const primera = await emitirFactura()
    const segunda = await emitirFactura()

    const doc1 = await getDocument(db, { tenantId: negocio.tenantId, documentId: primera.documentId })
    const doc2 = await getDocument(db, { tenantId: negocio.tenantId, documentId: segunda.documentId })

    expect(doc1.controlNumber).toBe('00-00000001')
    expect(doc2.controlNumber).toBeNull()
    // La segunda venta igual quedó emitida, con su consecutivo.
    expect(segunda.fullNumber).toBe('F-000002')

    const libro = (await listControlBooks(db, negocio.tenantId)).find((l) => l.kind === 'FACTURA')
    expect(libro?.remaining).toBe(0)
  })

  it('una nota de entrega nunca toca el talonario de facturas', async () => {
    await setControlRange(db, { tenantId: negocio.tenantId, kind: 'FACTURA', prefix: '00-', from: 1, to: 10 })

    const nota = await createSale(db, {
      tenantId: negocio.tenantId,
      stationId: negocio.stationId,
      userId: negocio.userId,
      // sin kind: por defecto es NOTA_ENTREGA
      currency: 'USD',
      lines: [{ productId: negocio.harina, quantity: 2000n }],
      payments: [{ method: 'EFECTIVO_BS', amount: ves(10975n) }],
      now: AHORA,
    })

    const doc = await getDocument(db, { tenantId: negocio.tenantId, documentId: nota.documentId })
    expect(doc.kind).toBe('NOTA_ENTREGA')
    expect(doc.controlNumber).toBeNull()

    // El talonario de facturas sigue intacto.
    const libro = (await listControlBooks(db, negocio.tenantId)).find((l) => l.kind === 'FACTURA')
    expect(libro?.next).toBe(1)
    expect(libro?.remaining).toBe(10)
  })
})

describe('lectura de documentos', () => {
  it('rechaza un rango de talonario inválido', async () => {
    await expect(
      setControlRange(db, { tenantId: negocio.tenantId, kind: 'FACTURA', from: 10, to: 1 }),
    ).rejects.toThrow()
  })

  it('busca una factura por su número de control', async () => {
    await setControlRange(db, { tenantId: negocio.tenantId, kind: 'FACTURA', prefix: '00-', from: 1, to: 10 })
    await emitirFactura()

    const porControl = await searchDocuments(db, { tenantId: negocio.tenantId, query: '00-00000001' })
    expect(porControl).toHaveLength(1)
    expect(porControl[0]?.kind).toBe('FACTURA')
    expect(porControl[0]?.controlNumber).toBe('00-00000001')
  })

  it('arma el documento completo con emisor, líneas y totales', async () => {
    await setControlRange(db, { tenantId: negocio.tenantId, kind: 'FACTURA', prefix: '00-', from: 1, to: 10 })
    const venta = await emitirFactura()

    const doc = await getDocument(db, { tenantId: negocio.tenantId, documentId: venta.documentId })
    expect(doc.kind).toBe('FACTURA')
    expect(doc.status).toBe('ISSUED')
    expect(doc.issuer.rif).toContain('J-')
    expect(doc.lines).toHaveLength(1)
    expect(doc.totals.grandTotal.amount).toBeGreaterThan(0n)
  })
})
