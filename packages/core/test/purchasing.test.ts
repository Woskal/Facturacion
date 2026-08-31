import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Database } from '@fve/db'
import { usd } from '@fve/money'

import {
  DuplicateSupplierError,
  EmptyPurchaseError,
  PurchaseOverpaidError,
  createPurchase,
  createSupplier,
  getPurchase,
  listPayables,
  listPurchases,
  registerPurchasePayment,
  searchSuppliers,
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
})

async function nuevoProveedor(suffix = '1') {
  const { supplierId } = await createSupplier(db, {
    tenantId: negocio.tenantId,
    idKind: 'J',
    idNumber: `4111222${suffix}`,
    name: `Distribuidora ${suffix}`,
    contactName: 'Juan',
    phone: '0412-1112222',
  })
  return supplierId
}

describe('proveedores', () => {
  it('crea y busca un proveedor', async () => {
    await nuevoProveedor()
    const encontrados = await searchSuppliers(db, { tenantId: negocio.tenantId, query: 'Distribuidora' })
    expect(encontrados).toHaveLength(1)
    expect(encontrados[0]?.name).toBe('Distribuidora 1')
    expect(encontrados[0]?.id).toBe('J-41112221')
  })

  it('no admite dos proveedores con la misma identificación', async () => {
    await nuevoProveedor()
    await expect(nuevoProveedor()).rejects.toThrow(DuplicateSupplierError)
  })
})

describe('compras', () => {
  it('registra la compra y suma la existencia del producto', async () => {
    const supplierId = await nuevoProveedor()
    const existenciaAntes = await stockOf(db, negocio.tenantId, negocio.harina)

    const { purchaseId } = await createPurchase(db, {
      tenantId: negocio.tenantId,
      userId: negocio.userId,
      supplierId,
      invoiceNumber: 'A-000123',
      currency: 'USD',
      iva: usd(160n), // $1,60
      lines: [{ productId: negocio.harina, description: 'Harina de maíz', quantity: 5000n, unitCost: usd(200n) }],
      now: AHORA,
    })

    // 5 unidades a $2,00: subtotal $10,00, IVA $1,60, total $11,60.
    const compra = await getPurchase(db, { tenantId: negocio.tenantId, purchaseId })
    expect(compra.net.amount).toBe(1000n)
    expect(compra.iva.amount).toBe(160n)
    expect(compra.total.amount).toBe(1160n)
    expect(compra.lines).toHaveLength(1)
    expect(compra.lines[0]?.sku).toBe('HAR-1')
    expect(compra.lines[0]?.lineTotal.amount).toBe(1000n)

    // La existencia subió en las 5 unidades compradas.
    const existenciaDespues = await stockOf(db, negocio.tenantId, negocio.harina)
    expect(existenciaDespues - existenciaAntes).toBe(5000n)
  })

  it('guarda el total también en la otra moneda, con la tasa del día', async () => {
    const supplierId = await nuevoProveedor()
    const { purchaseId } = await createPurchase(db, {
      tenantId: negocio.tenantId,
      userId: negocio.userId,
      supplierId,
      invoiceNumber: 'A-000124',
      currency: 'USD',
      iva: usd(0n),
      lines: [{ productId: negocio.harina, description: 'Harina', quantity: 1000n, unitCost: usd(1000n) }],
      now: AHORA,
    })

    const compra = await getPurchase(db, { tenantId: negocio.tenantId, purchaseId })
    // $10,00 a 36,5842 → Bs 365,84 (el resumen trae ambas monedas).
    const resumen = (await listPurchases(db, { tenantId: negocio.tenantId })).find(
      (c) => c.purchaseId === purchaseId,
    )
    expect(compra.total.amount).toBe(1000n)
    expect(resumen?.totalUsd.amount).toBe(1000n)
    expect(resumen?.totalVes.amount).toBe(36584n)
    expect(resumen?.supplierName).toBe('Distribuidora 1')
  })

  it('una línea libre sin producto no genera movimiento de existencia', async () => {
    const supplierId = await nuevoProveedor()
    const antes = await stockOf(db, negocio.tenantId, negocio.harina)

    await createPurchase(db, {
      tenantId: negocio.tenantId,
      userId: negocio.userId,
      supplierId,
      invoiceNumber: 'A-000125',
      currency: 'USD',
      iva: usd(0n),
      lines: [{ description: 'Flete', quantity: 1000n, unitCost: usd(500n) }],
      now: AHORA,
    })

    const despues = await stockOf(db, negocio.tenantId, negocio.harina)
    expect(despues).toBe(antes)
  })

  it('rechaza una compra sin renglones', async () => {
    const supplierId = await nuevoProveedor()
    await expect(
      createPurchase(db, {
        tenantId: negocio.tenantId,
        userId: negocio.userId,
        supplierId,
        invoiceNumber: 'A-0',
        currency: 'USD',
        iva: usd(0n),
        lines: [],
        now: AHORA,
      }),
    ).rejects.toThrow(EmptyPurchaseError)
  })
})

describe('cuentas por pagar', () => {
  async function compraACredito(invoiceNumber = 'A-900') {
    const supplierId = await nuevoProveedor()
    const { purchaseId } = await createPurchase(db, {
      tenantId: negocio.tenantId,
      userId: negocio.userId,
      supplierId,
      invoiceNumber,
      currency: 'USD',
      iva: usd(160n), // total = $10,00 + $1,60 = $11,60
      lines: [{ productId: negocio.harina, description: 'Harina', quantity: 5000n, unitCost: usd(200n) }],
      now: AHORA,
    })
    return purchaseId
  }

  it('una compra de contado no queda como cuenta por pagar', async () => {
    const supplierId = await nuevoProveedor()
    await createPurchase(db, {
      tenantId: negocio.tenantId,
      userId: negocio.userId,
      supplierId,
      invoiceNumber: 'A-800',
      currency: 'USD',
      iva: usd(160n),
      paidNow: usd(1160n), // $11,60 completo
      paidMethod: 'EFECTIVO_USD',
      lines: [{ productId: negocio.harina, description: 'Harina', quantity: 5000n, unitCost: usd(200n) }],
      now: AHORA,
    })

    const porPagar = await listPayables(db, { tenantId: negocio.tenantId })
    expect(porPagar).toHaveLength(0)
  })

  it('una compra a crédito aparece con su saldo y se salda con pagos', async () => {
    const purchaseId = await compraACredito()

    let porPagar = await listPayables(db, { tenantId: negocio.tenantId })
    expect(porPagar).toHaveLength(1)
    expect(porPagar[0]?.balance.amount).toBe(1160n)

    // Pago parcial de $10,00.
    const parcial = await registerPurchasePayment(db, {
      tenantId: negocio.tenantId,
      userId: negocio.userId,
      purchaseId,
      amount: usd(1000n),
    })
    expect(parcial.balance.amount).toBe(160n)
    expect(parcial.settled).toBe(false)

    // Pago del resto: queda saldada y sale de la lista.
    const final = await registerPurchasePayment(db, {
      tenantId: negocio.tenantId,
      userId: negocio.userId,
      purchaseId,
      amount: usd(160n),
    })
    expect(final.balance.amount).toBe(0n)
    expect(final.settled).toBe(true)

    porPagar = await listPayables(db, { tenantId: negocio.tenantId })
    expect(porPagar).toHaveLength(0)

    const compra = await getPurchase(db, { tenantId: negocio.tenantId, purchaseId })
    expect(compra.balance.amount).toBe(0n)
    expect(compra.payments).toHaveLength(2)
  })

  it('no admite pagar más que el saldo', async () => {
    const purchaseId = await compraACredito('A-901')
    await expect(
      registerPurchasePayment(db, {
        tenantId: negocio.tenantId,
        userId: negocio.userId,
        purchaseId,
        amount: usd(2000n),
      }),
    ).rejects.toThrow(PurchaseOverpaidError)
  })
})
