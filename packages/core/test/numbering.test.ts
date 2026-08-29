import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { schema, withTenant, type Database } from '@fve/db'
import { ves } from '@fve/money'

import {
  InvalidBlockSizeError,
  NumberAlreadyUsedError,
  NumberNotReservedError,
  createSale,
  listNumberBlocks,
  releaseNumberBlock,
  reserveNumberBlock,
  setRate,
} from '../src/index'
import { connect, resetDatabase, seedNegocio, stockOf, type Negocio } from './helpers'

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

function reservar(count = 5) {
  return reserveNumberBlock(db, {
    tenantId: negocio.tenantId,
    stationId: negocio.stationId,
    kind: 'NOTA_ENTREGA',
    count,
    userId: negocio.userId,
  })
}

/** Venta con número tomado del bloque, como la haría una caja sin conexión. */
function venderConNumero(numero: number, clientRef: string) {
  return createSale(db, {
    tenantId: negocio.tenantId,
    stationId: negocio.stationId,
    userId: negocio.userId,
    currency: 'USD',
    lines: [{ productId: negocio.harina, quantity: 2000n }],
    payments: [{ method: 'EFECTIVO_BS', amount: ves(10975n) }],
    reservedNumber: numero,
    clientRef,
    now: AHORA,
  })
}

describe('reserva de bloques', () => {
  it('aparta un rango de consecutivos', async () => {
    const bloque = await reservar(5)

    expect(bloque.from).toBe(1)
    expect(bloque.to).toBe(5)
    expect(bloque.remaining).toBe(5)
    expect(bloque.consumedUpTo).toBeNull()
    expect(bloque.prefix).toBe('NE')
  })

  it('LO QUE IMPORTA: lo apartado sale de la serie de inmediato', async () => {
    await reservar(5)

    // Una venta en línea, hecha después, NO puede caer dentro del bloque.
    const enLinea = await createSale(db, {
      tenantId: negocio.tenantId,
      stationId: negocio.stationId,
      userId: negocio.userId,
      currency: 'USD',
      lines: [{ productId: negocio.harina, quantity: 2000n }],
      payments: [{ method: 'EFECTIVO_BS', amount: ves(10975n) }],
      now: AHORA,
    })

    expect(enLinea.number).toBe(6)
  })

  it('dos bloques seguidos no se solapan', async () => {
    const uno = await reservar(3)
    const dos = await reservar(3)

    expect(uno.to).toBe(3)
    expect(dos.from).toBe(4)
    expect(dos.to).toBe(6)
  })

  it('rechaza tamaños absurdos', async () => {
    await expect(reservar(0)).rejects.toThrow(InvalidBlockSizeError)
    await expect(reservar(5000)).rejects.toThrow(InvalidBlockSizeError)
  })

  it('lista los bloques con lo que queda', async () => {
    await reservar(5)
    const bloques = await listNumberBlocks(db, {
      tenantId: negocio.tenantId,
      stationId: negocio.stationId,
    })

    expect(bloques).toHaveLength(1)
    expect(bloques[0]?.remaining).toBe(5)
  })
})

describe('venta con número reservado', () => {
  it('emite con el consecutivo apartado', async () => {
    await reservar(5)
    const venta = await venderConNumero(1, 'caja1-0001')

    expect(venta.number).toBe(1)
    expect(venta.fullNumber).toBe('NE-000001')
    expect(venta.totals.total.amount).toBe(300n)
  })

  it('descuenta lo consumido del bloque', async () => {
    await reservar(5)
    await venderConNumero(1, 'caja1-0001')
    await venderConNumero(2, 'caja1-0002')

    const bloques = await listNumberBlocks(db, {
      tenantId: negocio.tenantId,
      stationId: negocio.stationId,
    })
    expect(bloques[0]?.consumedUpTo).toBe(2)
    expect(bloques[0]?.remaining).toBe(3)
  })

  it('LO QUE IMPORTA: un número inventado no se emite', async () => {
    await reservar(5)

    // Fuera del bloque: emitirlo descuadraría la serie sin remedio.
    await expect(venderConNumero(99, 'caja1-0099')).rejects.toThrow(NumberNotReservedError)
  })

  it('sin ningún bloque tampoco', async () => {
    await expect(venderConNumero(1, 'caja1-0001')).rejects.toThrow(NumberNotReservedError)
  })

  it('no se repite un número ya usado', async () => {
    await reservar(5)
    await venderConNumero(2, 'caja1-0002')

    // El 1 quedó atrás: el bloque avanza, no retrocede.
    await expect(venderConNumero(1, 'caja1-0001')).rejects.toThrow(NumberAlreadyUsedError)
    await expect(venderConNumero(2, 'otro-ref')).rejects.toThrow(NumberAlreadyUsedError)
  })

  it('un bloque liberado deja de servir', async () => {
    const bloque = await reservar(5)
    await releaseNumberBlock(db, { tenantId: negocio.tenantId, reservationId: bloque.reservationId })

    await expect(venderConNumero(1, 'caja1-0001')).rejects.toThrow(NumberNotReservedError)
  })

  it('el bloque de una caja no sirve en otra', async () => {
    await reservar(5)

    const otraCaja = await withTenant(db, negocio.tenantId, async (tx) => {
      const [caja] = await tx
        .insert(schema.stations)
        .values({ tenantId: negocio.tenantId, name: 'Caja 2', code: 'C2' })
        .returning({ id: schema.stations.id })
      return caja!.id
    })

    await expect(
      createSale(db, {
        tenantId: negocio.tenantId,
        stationId: otraCaja,
        userId: negocio.userId,
        currency: 'USD',
        lines: [{ productId: negocio.harina, quantity: 2000n }],
        payments: [{ method: 'EFECTIVO_BS', amount: ves(10975n) }],
        reservedNumber: 1,
        now: AHORA,
      }),
    ).rejects.toThrow(NumberNotReservedError)
  })
})

describe('sincronización de lo vendido sin conexión', () => {
  it('reenviar la misma venta no emite dos ni descuenta dos veces', async () => {
    await reservar(5)

    const primera = await venderConNumero(1, 'caja1-0001')
    const segunda = await venderConNumero(1, 'caja1-0001')

    expect(segunda.deduplicated).toBe(true)
    expect(segunda.documentId).toBe(primera.documentId)
    expect(await stockOf(db, negocio.tenantId, negocio.harina)).toBe(-2000n)
  })

  it('un lote entero sube en orden y conserva sus números', async () => {
    await reservar(5)

    // La caja estuvo sin conexión y ahora vuelca lo acumulado.
    for (let numero = 1; numero <= 4; numero += 1) {
      await venderConNumero(numero, `caja1-000${numero}`)
    }

    const documentos = await withTenant(db, negocio.tenantId, (tx) =>
      tx
        .select({ number: schema.documents.number, fullNumber: schema.documents.fullNumber })
        .from(schema.documents)
        .orderBy(schema.documents.number),
    )

    expect(documentos.map((d) => d.fullNumber)).toEqual([
      'NE-000001',
      'NE-000002',
      'NE-000003',
      'NE-000004',
    ])
  })

  it('LO QUE IMPORTA: en línea y sin conexión nunca chocan', async () => {
    // La caja 1 se lleva un bloque antes de quedarse sin internet.
    await reservar(3)

    // Mientras tanto la caja 2 sigue vendiendo en línea.
    const enLinea = []
    for (let i = 0; i < 3; i += 1) {
      enLinea.push(
        await createSale(db, {
          tenantId: negocio.tenantId,
          stationId: negocio.stationId,
          userId: negocio.userId,
          currency: 'USD',
          lines: [{ productId: negocio.harina, quantity: 1000n }],
          payments: [{ method: 'EFECTIVO_BS', amount: ves(5487n) }],
          now: AHORA,
        }),
      )
    }

    // Y después sube lo que vendió sin conexión.
    for (let numero = 1; numero <= 3; numero += 1) {
      await venderConNumero(numero, `offline-${numero}`)
    }

    const numeros = await withTenant(db, negocio.tenantId, (tx) =>
      tx.select({ number: schema.documents.number }).from(schema.documents).orderBy(schema.documents.number),
    )

    const lista = numeros.map((n) => n.number)
    expect(lista).toEqual([1, 2, 3, 4, 5, 6])
    expect(new Set(lista).size).toBe(6)
    expect(enLinea.map((v) => v.number)).toEqual([4, 5, 6])
  })

  it('los números sin usar quedan como hueco, no vuelven a la serie', async () => {
    const bloque = await reservar(5)
    await venderConNumero(1, 'caja1-0001')
    await releaseNumberBlock(db, { tenantId: negocio.tenantId, reservationId: bloque.reservationId })

    const siguiente = await createSale(db, {
      tenantId: negocio.tenantId,
      stationId: negocio.stationId,
      userId: negocio.userId,
      currency: 'USD',
      lines: [{ productId: negocio.harina, quantity: 2000n }],
      payments: [{ method: 'EFECTIVO_BS', amount: ves(10975n) }],
      now: AHORA,
    })

    // Del 2 al 5 quedan como hueco justificado. Reciclarlos abriría la puerta a
    // que dos cajas emitan el mismo número.
    expect(siguiente.number).toBe(6)

    const bloques = await listNumberBlocks(db, {
      tenantId: negocio.tenantId,
      stationId: negocio.stationId,
    })
    expect(bloques).toHaveLength(0)
  })

  it('el documento queda enlazado a su serie aunque venga de un bloque', async () => {
    await reservar(3)
    const venta = await venderConNumero(1, 'caja1-0001')

    const [documento] = await withTenant(db, negocio.tenantId, (tx) =>
      tx.select().from(schema.documents).where(eq(schema.documents.id, venta.documentId)),
    )
    expect(documento?.seriesId).toBe(negocio.seriesId)
  })
})
