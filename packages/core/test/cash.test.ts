import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { schema, withTenant, type Database } from '@fve/db'
import { usd, ves } from '@fve/money'

import {
  SessionAlreadyClosedError,
  SessionAlreadyOpenError,
  closeCashSession,
  createSale,
  getCashSessionSummary,
  getOpenSession,
  openCashSession,
  setRate,
  voidSale,
  type CashSessionSummary,
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

function linea(codigo: 'harina' = 'harina', cantidad = 2000n) {
  return [{ productId: negocio[codigo], quantity: cantidad }]
}

function buscar(resumen: CashSessionSummary, method: string, currency: string) {
  return resumen.lines.find((line) => line.method === method && line.currency === currency)
}

async function abrir(fondoBs = 10000n, fondoUsd = 2000n) {
  const { sessionId } = await openCashSession(db, {
    tenantId: negocio.tenantId,
    stationId: negocio.stationId,
    userId: negocio.userId,
    opening: [
      { method: 'EFECTIVO_BS', currency: 'VES', amount: fondoBs },
      { method: 'EFECTIVO_USD', currency: 'USD', amount: fondoUsd },
    ],
    now: AHORA,
  })
  return sessionId
}

describe('apertura', () => {
  it('registra el fondo por medio y moneda', async () => {
    const sessionId = await abrir()
    const resumen = await getCashSessionSummary(db, negocio.tenantId, sessionId)

    // Un negocio bimonetario arranca con efectivo en las dos monedas a la vez.
    expect(buscar(resumen, 'EFECTIVO_BS', 'VES')?.opening.amount).toBe(10000n)
    expect(buscar(resumen, 'EFECTIVO_USD', 'USD')?.opening.amount).toBe(2000n)
    expect(resumen.closedAt).toBeNull()
  })

  it('no se pueden abrir dos turnos en la misma caja', async () => {
    await abrir()
    await expect(abrir()).rejects.toThrow(SessionAlreadyOpenError)
  })

  it('se puede consultar el turno abierto', async () => {
    const sessionId = await abrir()
    expect((await getOpenSession(db, negocio.tenantId, negocio.stationId))?.sessionId).toBe(sessionId)
  })

  it('sin turno abierto no hay nada que consultar', async () => {
    expect(await getOpenSession(db, negocio.tenantId, negocio.stationId)).toBeNull()
  })
})

describe('la venta se liga al turno abierto', () => {
  it('sin que el llamador tenga que acordarse', async () => {
    const sessionId = await abrir()

    const venta = await createSale(db, {
      tenantId: negocio.tenantId,
      stationId: negocio.stationId,
      userId: negocio.userId,
      currency: 'USD',
      lines: linea(),
      payments: [{ method: 'EFECTIVO_BS', amount: ves(10975n) }],
      now: AHORA,
    })

    const [doc] = await withTenant(db, negocio.tenantId, (tx) =>
      tx.select().from(schema.documents).where(eq(schema.documents.id, venta.documentId)),
    )
    expect(doc?.cashSessionId).toBe(sessionId)
  })

  it('sin turno abierto la venta queda sin turno, no falla', async () => {
    const venta = await createSale(db, {
      tenantId: negocio.tenantId,
      stationId: negocio.stationId,
      userId: negocio.userId,
      currency: 'USD',
      lines: linea(),
      payments: [{ method: 'EFECTIVO_BS', amount: ves(10975n) }],
      now: AHORA,
    })

    const [doc] = await withTenant(db, negocio.tenantId, (tx) =>
      tx.select().from(schema.documents).where(eq(schema.documents.id, venta.documentId)),
    )
    expect(doc?.cashSessionId).toBeNull()
  })
})

describe('arqueo', () => {
  it('suma el fondo más lo cobrado, por medio y moneda', async () => {
    const sessionId = await abrir()

    await createSale(db, {
      tenantId: negocio.tenantId,
      stationId: negocio.stationId,
      userId: negocio.userId,
      currency: 'USD',
      lines: linea(),
      payments: [{ method: 'EFECTIVO_BS', amount: ves(10975n) }],
      now: AHORA,
    })

    const resumen = await getCashSessionSummary(db, negocio.tenantId, sessionId)

    expect(buscar(resumen, 'EFECTIVO_BS', 'VES')?.expected.amount).toBe(10000n + 10975n)
    // La divisa no se movió: sigue el fondo intacto.
    expect(buscar(resumen, 'EFECTIVO_USD', 'USD')?.expected.amount).toBe(2000n)
    expect(resumen.documentCount).toBe(1)
  })

  it('LO QUE IMPORTA: el vuelto se descuenta del efectivo', async () => {
    const sessionId = await abrir()

    // Total $3,00 → con IGTF $3,09. Paga con $5,00 y se le devuelven $1,91.
    const venta = await createSale(db, {
      tenantId: negocio.tenantId,
      stationId: negocio.stationId,
      userId: negocio.userId,
      currency: 'USD',
      lines: linea(),
      payments: [{ method: 'EFECTIVO_USD', amount: usd(500n) }],
      now: AHORA,
    })

    expect(venta.settlement.change.amount).toBe(191n)

    const resumen = await getCashSessionSummary(db, negocio.tenantId, sessionId)

    // Entraron $5,00 y salieron $1,91. Sin descontar el vuelto, la caja
    // aparecería con un faltante de $1,91 que no existe.
    expect(buscar(resumen, 'EFECTIVO_USD', 'USD')?.expected.amount).toBe(2000n + 500n - 191n)
  })

  it('el crédito no entra a la caja: es una promesa de pago', async () => {
    const sessionId = await abrir()

    await createSale(db, {
      tenantId: negocio.tenantId,
      stationId: negocio.stationId,
      userId: negocio.userId,
      customerId: negocio.customerId,
      currency: 'USD',
      lines: linea(),
      payments: [{ method: 'CREDITO', amount: usd(300n) }],
      now: AHORA,
    })

    const resumen = await getCashSessionSummary(db, negocio.tenantId, sessionId)
    expect(buscar(resumen, 'CREDITO', 'USD')).toBeUndefined()
    expect(buscar(resumen, 'EFECTIVO_BS', 'VES')?.expected.amount).toBe(10000n)
  })

  it('una venta anulada no cuenta: el dinero se devolvió', async () => {
    const sessionId = await abrir()

    const venta = await createSale(db, {
      tenantId: negocio.tenantId,
      stationId: negocio.stationId,
      userId: negocio.userId,
      currency: 'USD',
      lines: linea(),
      payments: [{ method: 'EFECTIVO_BS', amount: ves(10975n) }],
      now: AHORA,
    })

    await voidSale(db, {
      tenantId: negocio.tenantId,
      documentId: venta.documentId,
      userId: negocio.userId,
      reason: 'Se arrepintió',
      now: AHORA,
    })

    const resumen = await getCashSessionSummary(db, negocio.tenantId, sessionId)
    expect(buscar(resumen, 'EFECTIVO_BS', 'VES')?.expected.amount).toBe(10000n)
    expect(resumen.documentCount).toBe(0)
  })

  it('separa medios distintos aunque compartan moneda', async () => {
    const sessionId = await abrir()

    await createSale(db, {
      tenantId: negocio.tenantId,
      stationId: negocio.stationId,
      userId: negocio.userId,
      currency: 'USD',
      lines: linea(),
      payments: [
        { method: 'EFECTIVO_BS', amount: ves(5487n) },
        { method: 'PAGO_MOVIL', amount: ves(5488n), reference: '004512' },
      ],
      now: AHORA,
    })

    const resumen = await getCashSessionSummary(db, negocio.tenantId, sessionId)

    // El pago móvil no está en la gaveta: va al banco y se concilia aparte.
    expect(buscar(resumen, 'EFECTIVO_BS', 'VES')?.expected.amount).toBe(10000n + 5487n)
    expect(buscar(resumen, 'PAGO_MOVIL', 'VES')?.expected.amount).toBe(5488n)
  })
})

describe('cierre', () => {
  it('guarda lo esperado y lo contado, y deja la diferencia a la vista', async () => {
    const sessionId = await abrir()

    await createSale(db, {
      tenantId: negocio.tenantId,
      stationId: negocio.stationId,
      userId: negocio.userId,
      currency: 'USD',
      lines: linea(),
      payments: [{ method: 'EFECTIVO_BS', amount: ves(10975n) }],
      now: AHORA,
    })

    // La persona cuenta Bs 200,00 de menos.
    const resumen = await closeCashSession(db, {
      tenantId: negocio.tenantId,
      sessionId,
      userId: negocio.userId,
      counted: [
        { method: 'EFECTIVO_BS', currency: 'VES', amount: 20775n },
        { method: 'EFECTIVO_USD', currency: 'USD', amount: 2000n },
      ],
      now: AHORA,
    })

    const efectivoBs = buscar(resumen, 'EFECTIVO_BS', 'VES')
    expect(efectivoBs?.expected.amount).toBe(20975n)
    expect(efectivoBs?.counted.amount).toBe(20775n)
    // Un descuadre visible es información; uno tapado es un robo que nadie nota.
    expect(efectivoBs?.difference.amount).toBe(-200n)
    expect(buscar(resumen, 'EFECTIVO_USD', 'USD')?.difference.amount).toBe(0n)
    expect(resumen.closedAt).not.toBeNull()
  })

  it('deja el turno cerrado y permite abrir otro', async () => {
    const sessionId = await abrir()
    await closeCashSession(db, {
      tenantId: negocio.tenantId,
      sessionId,
      userId: negocio.userId,
      counted: [],
      now: AHORA,
    })

    expect(await getOpenSession(db, negocio.tenantId, negocio.stationId)).toBeNull()
    await expect(abrir()).resolves.toBeTruthy()
  })

  it('no se cierra dos veces', async () => {
    const sessionId = await abrir()
    await closeCashSession(db, {
      tenantId: negocio.tenantId,
      sessionId,
      userId: negocio.userId,
      counted: [],
      now: AHORA,
    })

    await expect(
      closeCashSession(db, {
        tenantId: negocio.tenantId,
        sessionId,
        userId: negocio.userId,
        counted: [],
        now: AHORA,
      }),
    ).rejects.toThrow(SessionAlreadyClosedError)
  })
})
