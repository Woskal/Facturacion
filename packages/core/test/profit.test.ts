import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Database } from '@fve/db'
import { usd, ves } from '@fve/money'

import { createPurchase, createSale, createSupplier, profitReport, setRate } from '../src/index'
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
})

describe('ganancia con costo', () => {
  it('ganancia = ingreso de la venta menos el costo de la mercancía vendida', async () => {
    // Se compran 10 harinas a $1,00 (costo total $10,00 → Bs 365,84 a la tasa).
    const { supplierId } = await createSupplier(db, {
      tenantId: negocio.tenantId,
      idKind: 'J',
      idNumber: '400111222',
      name: 'Distribuidora',
    })
    await createPurchase(db, {
      tenantId: negocio.tenantId,
      userId: negocio.userId,
      supplierId,
      invoiceNumber: 'A-1',
      currency: 'USD',
      iva: usd(0n),
      lines: [{ productId: negocio.harina, description: 'Harina', quantity: 10000n, unitCost: usd(100n) }],
      now: AHORA,
    })

    // Se venden 2 harinas a $1,50 → ingreso $3,00 (Bs 109,75 a la tasa).
    await createSale(db, {
      tenantId: negocio.tenantId,
      stationId: negocio.stationId,
      userId: negocio.userId,
      currency: 'USD',
      lines: [{ productId: negocio.harina, quantity: 2000n }],
      payments: [{ method: 'EFECTIVO_BS', amount: ves(10975n) }],
      now: AHORA,
    })

    const reporte = await profitReport(db, { tenantId: negocio.tenantId, from: HOY, to: HOY })

    // Ingreso Bs 109,75; costo de 2 de 10 = Bs 73,17; ganancia Bs 36,58.
    expect(reporte.totals.revenue.amount).toBe(10975n)
    expect(reporte.totals.cost.amount).toBe(7317n)
    expect(reporte.totals.profit.amount).toBe(3658n)
    // Margen ≈ 33,3% → 3333 puntos básicos.
    expect(reporte.marginBps).toBe(3333)

    const fila = reporte.rows.find((r) => r.productId === negocio.harina)
    expect(fila?.hasCost).toBe(true)
    expect(fila?.profit.amount).toBe(3658n)
  })

  it('un producto vendido sin compra registrada aparece sin costo, no como ganancia total', async () => {
    // El servicio no tiene compras: se vende $10,00 sin IVA.
    await createSale(db, {
      tenantId: negocio.tenantId,
      stationId: negocio.stationId,
      userId: negocio.userId,
      currency: 'USD',
      lines: [{ productId: negocio.servicio, quantity: 1000n }],
      // Pago holgado en efectivo: el vuelto salda el resto, sin depender del
      // redondeo exacto de la liquidación.
      payments: [{ method: 'EFECTIVO_BS', amount: ves(50000n) }],
      now: AHORA,
    })

    const reporte = await profitReport(db, { tenantId: negocio.tenantId, from: HOY, to: HOY })
    const fila = reporte.rows.find((r) => r.productId === negocio.servicio)

    expect(fila?.hasCost).toBe(false)
    expect(fila?.cost.amount).toBe(0n)
    // La ganancia iguala el ingreso porque el costo se desconoce (marcado aparte).
    expect(fila?.profit.amount).toBe(fila?.revenue.amount)
  })
})
