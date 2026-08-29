import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { type Database } from '@fve/db'
import { usd, ves } from '@fve/money'

import {
  DuplicateCustomerError,
  DuplicateSkuError,
  OverpaidReceivableError,
  addReceivableEntry,
  adjustStock,
  archiveProduct,
  createCustomer,
  createProduct,
  createSale,
  customerHistory,
  listReceivables,
  listTaxRates,
  lowStockProducts,
  searchCustomers,
  searchProducts,
  setRate,
  stockOf,
  updateProduct,
} from '../src/index'
import { connect, resetDatabase, seedNegocio, type Negocio } from './helpers'

const HOY = '2026-08-28'
const AHORA = new Date('2026-08-28T12:00:00')

let db: Database
let close: () => Promise<void>
let negocio: Negocio
let ivaGeneral: string

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
  ivaGeneral = negocio.ivaGeneral
  await setRate(db, { tenantId: negocio.tenantId, value: '36,5842', effectiveOn: HOY, userId: negocio.userId })
})

async function nuevoProducto(sku = 'AZU-1', overrides: Record<string, unknown> = {}) {
  return createProduct(db, {
    tenantId: negocio.tenantId,
    userId: negocio.userId,
    sku,
    name: 'Azúcar 1 kg',
    taxRateId: ivaGeneral,
    price: usd(180n),
    now: AHORA,
    ...overrides,
  })
}

describe('catálogo', () => {
  it('da de alta un producto con su precio', async () => {
    const { productId } = await nuevoProducto()
    const encontrados = await searchProducts(db, { tenantId: negocio.tenantId, query: 'Azúcar' })

    const producto = encontrados.find((row) => row.productId === productId)
    expect(producto?.sku).toBe('AZU-1')
    expect(producto?.price.amount).toBe(180n)
    expect(producto?.price.currency).toBe('USD')
    expect(producto?.taxCode).toBe('G')
  })

  it('no admite dos productos con el mismo código', async () => {
    await nuevoProducto()
    await expect(nuevoProducto()).rejects.toThrow(DuplicateSkuError)
  })

  it('registra la existencia inicial como movimiento', async () => {
    const { productId } = await nuevoProducto('AZU-2', { initialStock: 50000n })
    expect(await stockOf(db, negocio.tenantId, productId)).toBe(50000n)
  })

  it('busca por nombre, código y código de barras', async () => {
    await nuevoProducto('AZU-3', { barcode: '7591234567890' })

    for (const query of ['Azúcar', 'AZU-3', '759123']) {
      const encontrados = await searchProducts(db, { tenantId: negocio.tenantId, query })
      expect(encontrados.some((row) => row.sku === 'AZU-3'), `no encontró con "${query}"`).toBe(true)
    }
  })

  it('sin búsqueda devuelve todo el catálogo', async () => {
    const todos = await searchProducts(db, { tenantId: negocio.tenantId })
    // Los tres del negocio sembrado.
    expect(todos.length).toBeGreaterThanOrEqual(3)
  })

  it('un producto archivado sale del catálogo pero no del pasado', async () => {
    const { productId } = await nuevoProducto('AZU-4')
    await archiveProduct(db, { tenantId: negocio.tenantId, productId, now: AHORA })

    const encontrados = await searchProducts(db, { tenantId: negocio.tenantId, query: 'AZU-4' })
    expect(encontrados).toHaveLength(0)
  })

  it('cambiar el precio no altera lo ya vendido', async () => {
    const { productId } = await nuevoProducto('AZU-5', { initialStock: 10000n })

    const venta = await createSale(db, {
      tenantId: negocio.tenantId,
      stationId: negocio.stationId,
      userId: negocio.userId,
      currency: 'USD',
      lines: [{ productId, quantity: 1000n }],
      payments: [{ method: 'EFECTIVO_BS', amount: ves(6585n) }],
      now: AHORA,
    })

    await updateProduct(db, { tenantId: negocio.tenantId, productId, price: usd(500n), name: 'Azúcar morena' })

    // La línea guardó copiados el nombre y el precio del momento.
    expect(venta.totals.total.amount).toBe(180n)
    const actualizado = await searchProducts(db, { tenantId: negocio.tenantId, query: 'AZU-5' })
    expect(actualizado[0]?.price.amount).toBe(500n)
    expect(actualizado[0]?.name).toBe('Azúcar morena')
  })

  it('expone las alícuotas del negocio', async () => {
    const alicuotas = await listTaxRates(db, negocio.tenantId)
    expect(alicuotas.map((row) => row.code).sort()).toEqual(['E', 'G'])
  })
})

describe('inventario', () => {
  it('un ajuste deja movimiento con su razón', async () => {
    const { productId } = await nuevoProducto('AZU-6', { initialStock: 10000n })

    await adjustStock(db, {
      tenantId: negocio.tenantId,
      userId: negocio.userId,
      productId,
      quantity: -2000n,
      reason: 'Merma por humedad',
      now: AHORA,
    })

    expect(await stockOf(db, negocio.tenantId, productId)).toBe(8000n)
  })

  it('exige una razón: sin rastro es como desaparece mercancía', async () => {
    const { productId } = await nuevoProducto('AZU-7')
    await expect(
      adjustStock(db, {
        tenantId: negocio.tenantId,
        userId: negocio.userId,
        productId,
        quantity: -1000n,
        reason: '   ',
      }),
    ).rejects.toThrow(/razón/)
  })

  it('un ajuste de cero no tiene sentido', async () => {
    const { productId } = await nuevoProducto('AZU-8')
    await expect(
      adjustStock(db, {
        tenantId: negocio.tenantId,
        userId: negocio.userId,
        productId,
        quantity: 0n,
        reason: 'nada',
      }),
    ).rejects.toThrow(/cero/)
  })

  it('avisa de lo que está en el mínimo o por debajo', async () => {
    const { productId } = await nuevoProducto('AZU-9', { initialStock: 5000n, minStock: 10000n })
    await nuevoProducto('AZU-10', { initialStock: 50000n, minStock: 10000n })

    const bajos = await lowStockProducts(db, negocio.tenantId)
    expect(bajos.map((row) => row.productId)).toContain(productId)
    expect(bajos.some((row) => row.sku === 'AZU-10')).toBe(false)
  })

  it('sin mínimo configurado no hay alerta', async () => {
    await nuevoProducto('AZU-11', { initialStock: 0n })
    const bajos = await lowStockProducts(db, negocio.tenantId)
    expect(bajos.some((row) => row.sku === 'AZU-11')).toBe(false)
  })
})

describe('clientes', () => {
  it('da de alta y busca por nombre o cédula', async () => {
    await createCustomer(db, {
      tenantId: negocio.tenantId,
      idKind: 'V',
      idNumber: '20111222',
      name: 'Pedro Rodríguez',
      phone: '0412-1234567',
    })

    expect(await searchCustomers(db, { tenantId: negocio.tenantId, query: 'Pedro' })).toHaveLength(1)
    expect(await searchCustomers(db, { tenantId: negocio.tenantId, query: '20111222' })).toHaveLength(1)
    expect(await searchCustomers(db, { tenantId: negocio.tenantId, query: 'V-20111222' })).toHaveLength(1)
  })

  it('no admite dos clientes con la misma identificación', async () => {
    const entrada = {
      tenantId: negocio.tenantId,
      idKind: 'V' as const,
      idNumber: '20111222',
      name: 'Pedro',
    }
    await createCustomer(db, entrada)
    await expect(createCustomer(db, entrada)).rejects.toThrow(DuplicateCustomerError)
  })

  it('lista el historial de compras', async () => {
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

    const historial = await customerHistory(db, {
      tenantId: negocio.tenantId,
      customerId: negocio.customerId,
    })
    expect(historial).toHaveLength(1)
    expect(historial[0]?.fullNumber).toBe('NE-000001')
  })
})

describe('cartera', () => {
  async function ventaACredito() {
    const venta = await createSale(db, {
      tenantId: negocio.tenantId,
      stationId: negocio.stationId,
      userId: negocio.userId,
      customerId: negocio.customerId,
      currency: 'USD',
      lines: [{ productId: negocio.harina, quantity: 2000n }],
      payments: [{ method: 'CREDITO', amount: usd(300n) }],
      now: AHORA,
    })
    const [pendiente] = await listReceivables(db, { tenantId: negocio.tenantId })
    return { venta, receivableId: pendiente?.receivableId as string }
  }

  it('lista lo pendiente con su saldo', async () => {
    await ventaACredito()
    const cartera = await listReceivables(db, { tenantId: negocio.tenantId })

    expect(cartera).toHaveLength(1)
    expect(cartera[0]?.original.amount).toBe(300n)
    expect(cartera[0]?.balance.amount).toBe(300n)
    expect(cartera[0]?.customerName).toBe('María Pérez')
    expect(cartera[0]?.settled).toBe(false)
  })

  it('un abono reduce el saldo', async () => {
    const { receivableId } = await ventaACredito()

    const resultado = await addReceivableEntry(db, {
      tenantId: negocio.tenantId,
      userId: negocio.userId,
      receivableId,
      kind: 'PAYMENT',
      amount: usd(100n),
      method: 'EFECTIVO_USD',
      now: AHORA,
    })

    expect(resultado.balance.amount).toBe(200n)
    expect(resultado.settled).toBe(false)
  })

  it('LO QUE IMPORTA: una deuda en dólares se abona en bolívares a la tasa del día', async () => {
    const { receivableId } = await ventaACredito()

    // Bs 36,58 son $1,00 a la tasa de hoy.
    const resultado = await addReceivableEntry(db, {
      tenantId: negocio.tenantId,
      userId: negocio.userId,
      receivableId,
      kind: 'PAYMENT',
      amount: ves(3658n),
      method: 'PAGO_MOVIL',
      reference: '004512',
      now: AHORA,
    })

    expect(resultado.balance.amount).toBe(200n)
  })

  it('la retención de IVA salda parte de la deuda aunque no entre efectivo', async () => {
    const { receivableId } = await ventaACredito()

    // Un contribuyente especial retiene el 75% del IVA: de $0,41 son $0,31.
    const resultado = await addReceivableEntry(db, {
      tenantId: negocio.tenantId,
      userId: negocio.userId,
      receivableId,
      kind: 'RETENTION_IVA',
      amount: usd(31n),
      retentionNumber: '20260800012345',
      now: AHORA,
    })

    // Sin poder registrarlo, quedaría un saldo que nadie va a cobrar nunca.
    expect(resultado.balance.amount).toBe(269n)
  })

  it('al llegar a cero la cuenta se salda sola', async () => {
    const { receivableId } = await ventaACredito()

    const resultado = await addReceivableEntry(db, {
      tenantId: negocio.tenantId,
      userId: negocio.userId,
      receivableId,
      kind: 'PAYMENT',
      amount: usd(300n),
      now: AHORA,
    })

    expect(resultado.settled).toBe(true)
    expect(await listReceivables(db, { tenantId: negocio.tenantId })).toHaveLength(0)
    expect(await listReceivables(db, { tenantId: negocio.tenantId, includeSettled: true })).toHaveLength(1)
  })

  it('no se puede abonar más de lo que se debe', async () => {
    const { receivableId } = await ventaACredito()
    await expect(
      addReceivableEntry(db, {
        tenantId: negocio.tenantId,
        userId: negocio.userId,
        receivableId,
        kind: 'PAYMENT',
        amount: usd(500n),
        now: AHORA,
      }),
    ).rejects.toThrow(OverpaidReceivableError)
  })

  it('se puede filtrar la cartera por cliente', async () => {
    await ventaACredito()
    const otro = await createCustomer(db, {
      tenantId: negocio.tenantId,
      idKind: 'V',
      idNumber: '30222333',
      name: 'Otro Cliente',
    })

    expect(
      await listReceivables(db, { tenantId: negocio.tenantId, customerId: negocio.customerId }),
    ).toHaveLength(1)
    expect(await listReceivables(db, { tenantId: negocio.tenantId, customerId: otro.customerId })).toHaveLength(0)
  })
})
