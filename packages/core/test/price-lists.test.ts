import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Database } from '@fve/db'
import { usd, ves } from '@fve/money'

import { createSale, listPriceLists, searchProducts, setProductPrice, setRate } from '../src/index'
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

describe('listas de precios', () => {
  it('crea la lista mayor la primera vez que se consulta', async () => {
    const listas = await listPriceLists(db, negocio.tenantId)
    expect(listas.some((l) => l.isDefault)).toBe(true)
    expect(listas.some((l) => l.name === 'Mayor')).toBe(true)
    // La predeterminada va primero.
    expect(listas[0]?.isDefault).toBe(true)
  })

  it('la búsqueda muestra el precio de la lista pedida, con respaldo a la predeterminada', async () => {
    const mayor = (await listPriceLists(db, negocio.tenantId)).find((l) => l.name === 'Mayor')!
    // Harina: detal $1,50 (del seed). Mayor $1,00.
    await setProductPrice(db, { tenantId: negocio.tenantId, productId: negocio.harina, priceListId: mayor.id, price: usd(100n) })

    const detal = await searchProducts(db, { tenantId: negocio.tenantId, query: 'Harina' })
    expect(detal.find((p) => p.productId === negocio.harina)?.price.amount).toBe(150n)

    const alMayor = await searchProducts(db, { tenantId: negocio.tenantId, query: 'Harina', priceListId: mayor.id })
    expect(alMayor.find((p) => p.productId === negocio.harina)?.price.amount).toBe(100n)

    // El pan no tiene precio mayor cargado: cae al de detal ($2,00 del seed).
    const panMayor = await searchProducts(db, { tenantId: negocio.tenantId, query: 'Pan', priceListId: mayor.id })
    expect(panMayor.find((p) => p.productId === negocio.pan)?.price.amount).toBe(200n)
  })

  it('la venta al mayor aplica el precio de esa lista', async () => {
    const mayor = (await listPriceLists(db, negocio.tenantId)).find((l) => l.name === 'Mayor')!
    await setProductPrice(db, { tenantId: negocio.tenantId, productId: negocio.harina, priceListId: mayor.id, price: usd(100n) })

    // 2 harinas al mayor ($1,00) = $2,00, no $3,00 (el detal).
    const venta = await createSale(db, {
      tenantId: negocio.tenantId,
      stationId: negocio.stationId,
      userId: negocio.userId,
      priceListId: mayor.id,
      currency: 'USD',
      lines: [{ productId: negocio.harina, quantity: 2000n }],
      payments: [{ method: 'EFECTIVO_BS', amount: ves(10000n) }],
      now: AHORA,
    })
    expect(venta.totals.total.amount).toBe(200n)
  })
})
