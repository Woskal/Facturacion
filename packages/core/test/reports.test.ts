import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { type Database } from '@fve/db'
import { usd, ves } from '@fve/money'

import {
  createSale,
  dailySales,
  salesBook,
  salesBookToCsv,
  salesByMethod,
  setRate,
  topProducts,
  voidSale,
} from '../src/index'
import { connect, resetDatabase, seedNegocio, type Negocio } from './helpers'

const HOY = '2026-08-28'
const AHORA = new Date('2026-08-28T12:00:00')

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
  await setRate(db, { tenantId: negocio.tenantId, value: '36,5842', effectiveOn: HOY, userId: negocio.userId })
})

/** Harina (general 16%) y pan (exento), pagados en bolívares. */
async function ventaMixta() {
  return createSale(db, {
    tenantId: negocio.tenantId,
    stationId: negocio.stationId,
    userId: negocio.userId,
    currency: 'USD',
    lines: [
      { productId: negocio.harina, quantity: 2000n },
      { productId: negocio.pan, quantity: 1000n },
    ],
    payments: [{ method: 'EFECTIVO_BS', amount: ves(18292n) }],
    now: AHORA,
  })
}

describe('libro de ventas', () => {
  it('desglosa cada documento por alícuota, en bolívares', async () => {
    await ventaMixta()
    const libro = await salesBook(db, { tenantId: negocio.tenantId, from: HOY, to: HOY })

    expect(libro.rows).toHaveLength(1)
    const fila = libro.rows[0]!

    // El libro se lleva en bolívares aunque el negocio facture en dólares.
    expect(fila.baseGeneral.currency).toBe('VES')
    expect(fila.baseGeneral.amount).toBe(9475n) // $2,59
    expect(fila.ivaGeneral.amount).toBe(1500n) // $0,41
    expect(fila.exempt.amount).toBe(7317n) // $2,00
    expect(fila.fullNumber).toBe('NE-000001')
    expect(fila.customerName).toBe('Consumidor final')
  })

  it('LO QUE IMPORTA: base más exento más IVA da el total, al céntimo', async () => {
    await ventaMixta()
    const libro = await salesBook(db, { tenantId: negocio.tenantId, from: HOY, to: HOY })
    const fila = libro.rows[0]!

    const suma =
      fila.baseGeneral.amount +
      fila.baseReducida.amount +
      fila.baseSuntuaria.amount +
      fila.exempt.amount +
      fila.ivaGeneral.amount +
      fila.ivaReducida.amount +
      fila.ivaSuntuaria.amount +
      fila.igtf.amount

    // Un libro que no suma no es un libro.
    expect(suma).toBe(fila.total.amount)
  })

  it('incluye los anulados en cero, para justificar el salto en la numeración', async () => {
    const venta = await ventaMixta()
    await voidSale(db, {
      tenantId: negocio.tenantId,
      documentId: venta.documentId,
      userId: negocio.userId,
      reason: 'Error del cajero',
      now: AHORA,
    })

    const libro = await salesBook(db, { tenantId: negocio.tenantId, from: HOY, to: HOY })

    // Un salto sin explicación es lo primero que pregunta una fiscalización.
    expect(libro.rows).toHaveLength(1)
    expect(libro.rows[0]?.voided).toBe(true)
    expect(libro.rows[0]?.total.amount).toBe(0n)
    expect(libro.rows[0]?.baseGeneral.amount).toBe(0n)
    expect(libro.totals.total.amount).toBe(0n)
  })

  it('identifica al cliente cuando lo hay', async () => {
    await createSale(db, {
      tenantId: negocio.tenantId,
      stationId: negocio.stationId,
      userId: negocio.userId,
      customerId: negocio.customerId,
      currency: 'USD',
      lines: [{ productId: negocio.harina, quantity: 2000n }],
      payments: [{ method: 'EFECTIVO_BS', amount: ves(10975n) }],
      now: AHORA,
    })

    const libro = await salesBook(db, { tenantId: negocio.tenantId, from: HOY, to: HOY })
    expect(libro.rows[0]?.customerName).toBe('V-12345678 María Pérez')
  })

  it('registra el IGTF en su propia columna', async () => {
    await createSale(db, {
      tenantId: negocio.tenantId,
      stationId: negocio.stationId,
      userId: negocio.userId,
      currency: 'USD',
      lines: [{ productId: negocio.harina, quantity: 2000n }],
      payments: [{ method: 'EFECTIVO_USD', amount: usd(309n) }],
      now: AHORA,
    })

    const libro = await salesBook(db, { tenantId: negocio.tenantId, from: HOY, to: HOY })
    expect(libro.rows[0]?.igtf.amount).toBeGreaterThan(0n)
  })

  it('totaliza el período', async () => {
    await ventaMixta()
    await ventaMixta()

    const libro = await salesBook(db, { tenantId: negocio.tenantId, from: HOY, to: HOY })
    expect(libro.rows).toHaveLength(2)
    expect(libro.totals.baseGeneral.amount).toBe(9475n * 2n)
    expect(libro.totals.exempt.amount).toBe(7317n * 2n)
  })

  it('deja fuera lo que no pertenece al período', async () => {
    await ventaMixta()
    const libro = await salesBook(db, {
      tenantId: negocio.tenantId,
      from: '2026-09-01',
      to: '2026-09-30',
    })
    expect(libro.rows).toHaveLength(0)
  })

  it('sale a CSV con separadores que Excel en español entiende', async () => {
    await ventaMixta()
    const libro = await salesBook(db, { tenantId: negocio.tenantId, from: HOY, to: HOY })
    const csv = salesBookToCsv(libro)
    const lineas = csv.split('\r\n')

    expect(lineas[0]).toContain('Fecha;Documento')
    // Punto y coma de separador, coma decimal: con coma de separador cada
    // importe se partiría en dos columnas.
    expect(lineas[1]).toContain('94,75')
    expect(lineas[lineas.length - 1]).toContain('TOTALES')
  })
})

describe('resúmenes', () => {
  it('agrupa las ventas por día', async () => {
    await ventaMixta()
    await ventaMixta()

    const dias = await dailySales(db, { tenantId: negocio.tenantId, from: HOY, to: HOY })
    expect(dias).toHaveLength(1)
    expect(dias[0]?.documents).toBe(2)
    expect(dias[0]?.totalUsd.amount).toBe(1000n) // $5,00 × 2
  })

  it('separa lo cobrado por medio de pago', async () => {
    await createSale(db, {
      tenantId: negocio.tenantId,
      stationId: negocio.stationId,
      userId: negocio.userId,
      currency: 'USD',
      lines: [{ productId: negocio.harina, quantity: 2000n }],
      payments: [
        { method: 'EFECTIVO_BS', amount: ves(5487n) },
        { method: 'PAGO_MOVIL', amount: ves(5488n), reference: '004512' },
      ],
      now: AHORA,
    })

    const medios = await salesByMethod(db, { tenantId: negocio.tenantId, from: HOY, to: HOY })
    expect(medios).toHaveLength(2)
    expect(medios.find((m) => m.method === 'PAGO_MOVIL')?.received.amount).toBe(5488n)
  })

  it('LO QUE IMPORTA: al efectivo se le resta el vuelto, igual que en el arqueo', async () => {
    // Total $4,50 → con IGTF $4,64. Paga con $10,00 y se le devuelven $5,36.
    await createSale(db, {
      tenantId: negocio.tenantId,
      stationId: negocio.stationId,
      userId: negocio.userId,
      currency: 'USD',
      lines: [{ productId: negocio.harina, quantity: 3000n }],
      payments: [{ method: 'EFECTIVO_USD', amount: usd(1000n) }],
      now: AHORA,
    })

    const medios = await salesByMethod(db, { tenantId: negocio.tenantId, from: HOY, to: HOY })
    const efectivo = medios.find((m) => m.method === 'EFECTIVO_USD')

    // Sumar los $10,00 sin descontar el vuelto contradiría el conteo de la
    // gaveta, que sí lo resta.
    expect(efectivo?.received.amount).toBe(464n)
  })

  it('a los medios que no son efectivo no se les resta nada', async () => {
    await createSale(db, {
      tenantId: negocio.tenantId,
      stationId: negocio.stationId,
      userId: negocio.userId,
      currency: 'USD',
      lines: [{ productId: negocio.harina, quantity: 2000n }],
      payments: [{ method: 'PAGO_MOVIL', amount: ves(10975n), reference: '004512' }],
      now: AHORA,
    })

    const medios = await salesByMethod(db, { tenantId: negocio.tenantId, from: HOY, to: HOY })
    // Lo que salió del banco del cliente entró completo.
    expect(medios.find((m) => m.method === 'PAGO_MOVIL')?.received.amount).toBe(10975n)
  })

  it('ordena lo más vendido por importe', async () => {
    await ventaMixta()

    const top = await topProducts(db, { tenantId: negocio.tenantId, from: HOY, to: HOY })
    expect(top).toHaveLength(2)
    // Harina $3,00 supera a pan $2,00.
    expect(top[0]?.name).toBe('Harina de maíz 1 kg')
    expect(top[0]?.quantity).toBe(2000n)
    expect(top[0]?.totalVes.currency).toBe('VES')
  })

  it('una venta anulada no cuenta en ningún resumen', async () => {
    const venta = await ventaMixta()
    await voidSale(db, {
      tenantId: negocio.tenantId,
      documentId: venta.documentId,
      userId: negocio.userId,
      reason: 'x',
      now: AHORA,
    })

    expect(await dailySales(db, { tenantId: negocio.tenantId, from: HOY, to: HOY })).toHaveLength(0)
    expect(await salesByMethod(db, { tenantId: negocio.tenantId, from: HOY, to: HOY })).toHaveLength(0)
    expect(await topProducts(db, { tenantId: negocio.tenantId, from: HOY, to: HOY })).toHaveLength(0)
  })
})

describe('el pasado no se reescribe', () => {
  it('el libro conserva los importes de su día aunque cambie la tasa', async () => {
    await ventaMixta()
    const antes = await salesBook(db, { tenantId: negocio.tenantId, from: HOY, to: HOY })

    // La tasa se dispara al día siguiente.
    await setRate(db, { tenantId: negocio.tenantId, value: '800,0000', effectiveOn: '2026-08-29' })

    const despues = await salesBook(db, { tenantId: negocio.tenantId, from: HOY, to: HOY })
    expect(despues.totals.total.amount).toBe(antes.totals.total.amount)
    expect(despues.rows[0]?.baseGeneral.amount).toBe(antes.rows[0]?.baseGeneral.amount)
  })
})
