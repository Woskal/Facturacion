import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Database } from '@fve/db'
import { usd } from '@fve/money'

import { addReceivableEntry, createSale, listReceivables, listRetentions, setRate } from '../src/index'
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

describe('retenciones recibidas', () => {
  it('lista las retenciones de IVA que un cliente aplicó, con su comprobante', async () => {
    // Venta a crédito para tener una cuenta por cobrar.
    await createSale(db, {
      tenantId: negocio.tenantId,
      stationId: negocio.stationId,
      userId: negocio.userId,
      currency: 'USD',
      customerId: negocio.customerId,
      lines: [{ productId: negocio.harina, quantity: 2000n }],
      payments: [{ method: 'CREDITO', amount: usd(300n) }],
      now: AHORA,
    })

    const [cuenta] = await listReceivables(db, { tenantId: negocio.tenantId })
    expect(cuenta).toBeDefined()

    // El cliente paga y retiene el IVA: se registra con su comprobante.
    await addReceivableEntry(db, {
      tenantId: negocio.tenantId,
      userId: negocio.userId,
      receivableId: cuenta!.receivableId,
      kind: 'RETENTION_IVA',
      amount: usd(31n),
      retentionNumber: '20260800012345',
      now: AHORA,
    })

    const retenciones = await listRetentions(db, { tenantId: negocio.tenantId, from: HOY, to: HOY })
    expect(retenciones).toHaveLength(1)
    expect(retenciones[0]?.kind).toBe('RETENTION_IVA')
    expect(retenciones[0]?.retentionNumber).toBe('20260800012345')
    expect(retenciones[0]?.customerName).toBe('María Pérez')
    expect(retenciones[0]?.amount.amount).toBeGreaterThan(0n)
  })

  it('un pago normal no aparece como retención', async () => {
    await createSale(db, {
      tenantId: negocio.tenantId,
      stationId: negocio.stationId,
      userId: negocio.userId,
      currency: 'USD',
      customerId: negocio.customerId,
      lines: [{ productId: negocio.harina, quantity: 2000n }],
      payments: [{ method: 'CREDITO', amount: usd(300n) }],
      now: AHORA,
    })
    const [cuenta] = await listReceivables(db, { tenantId: negocio.tenantId })
    await addReceivableEntry(db, {
      tenantId: negocio.tenantId,
      userId: negocio.userId,
      receivableId: cuenta!.receivableId,
      kind: 'PAYMENT',
      amount: usd(100n),
      now: AHORA,
    })

    const retenciones = await listRetentions(db, { tenantId: negocio.tenantId, from: HOY, to: HOY })
    expect(retenciones).toHaveLength(0)
  })
})
