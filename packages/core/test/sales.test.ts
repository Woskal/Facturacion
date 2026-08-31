import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { schema, withTenant, type Database } from '@fve/db'
import { usd, ves } from '@fve/money'

import {
  CreditRequiresCustomerError,
  EmptySaleError,
  MissingRateError,
  UnsettledSaleError,
  createSale,
  getRateFor,
  setRate,
  voidSale,
} from '../src/index'
import { connect, resetDatabase, seedNegocio, stockOf, type Negocio } from './helpers'

const HOY = '2026-08-28'
const AYER = '2026-08-27'
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

/** Dos kilos de harina: $1,50 cada uno con IVA incluido. */
function dosHarinas() {
  return [{ productId: negocio.harina, quantity: 2000n }]
}

describe('tasa del día', () => {
  it('se carga y se recupera', async () => {
    const tasa = await getRateFor(db, negocio.tenantId, HOY)
    expect(tasa.bsPerUsd).toBe(3658420000n)
    expect(tasa.date).toBe(HOY)
  })

  it('un día sin tasa usa la última anterior: el domingo se factura con la del viernes', async () => {
    const tasa = await getRateFor(db, negocio.tenantId, '2026-08-30')
    expect(tasa.date).toBe(HOY)
  })

  it('nunca usa una tasa posterior, que en su momento no existía', async () => {
    await expect(getRateFor(db, negocio.tenantId, AYER)).rejects.toThrow(MissingRateError)
  })

  it('se puede corregir la del día', async () => {
    await setRate(db, { tenantId: negocio.tenantId, value: '40,0000', effectiveOn: HOY })
    expect((await getRateFor(db, negocio.tenantId, HOY)).bsPerUsd).toBe(4000000000n)
  })
})

describe('emisión de una venta', () => {
  it('calcula el documento y lo deja emitido', async () => {
    const venta = await createSale(db, {
      tenantId: negocio.tenantId,
      stationId: negocio.stationId,
      userId: negocio.userId,
      currency: 'USD',
      lines: dosHarinas(),
      payments: [{ method: 'EFECTIVO_BS', amount: ves(10975n) }],
      now: AHORA,
    })

    // $1,50 × 2 = $3,00 con IVA incluido → base 2,59 + IVA 0,41
    expect(venta.totals.total.amount).toBe(300n)
    expect(venta.totals.base.amount).toBe(259n)
    expect(venta.totals.ivaTotal.amount).toBe(41n)
    expect(venta.fullNumber).toBe('NE-000001')
    expect(venta.settlement.balance.amount).toBe(0n)

    const rows = await withTenant(db, negocio.tenantId, (tx) =>
      tx.select().from(schema.documents).where(eq(schema.documents.id, venta.documentId)),
    )
    expect(rows[0]?.status).toBe('ISSUED')
    expect(rows[0]?.issuedAt).not.toBeNull()
  })

  it('persiste las líneas con la descripción y la alícuota copiadas', async () => {
    const venta = await createSale(db, {
      tenantId: negocio.tenantId,
      stationId: negocio.stationId,
      userId: negocio.userId,
      currency: 'USD',
      lines: dosHarinas(),
      payments: [{ method: 'EFECTIVO_BS', amount: ves(10975n) }],
      now: AHORA,
    })

    const lines = await withTenant(db, negocio.tenantId, (tx) =>
      tx.select().from(schema.documentLines).where(eq(schema.documentLines.documentId, venta.documentId)),
    )

    expect(lines).toHaveLength(1)
    // Si mañana cambia el nombre del producto o el decreto cambia el IVA, el
    // documento tiene que seguir diciendo lo que decía al imprimirse.
    expect(lines[0]?.description).toBe('Harina de maíz 1 kg')
    expect(lines[0]?.taxBaseBps).toBe(1600)
    expect(lines[0]?.total).toBe(300n)
  })

  it('persiste el desglose por alícuota, que es la fuente del libro de ventas', async () => {
    const venta = await createSale(db, {
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

    expect(venta.totals.base.amount).toBe(259n)
    expect(venta.totals.exempt.amount).toBe(200n)
    expect(venta.totals.total.amount).toBe(500n)

    const desglose = await withTenant(db, negocio.tenantId, (tx) =>
      tx
        .select()
        .from(schema.documentTaxBreakdown)
        .where(eq(schema.documentTaxBreakdown.documentId, venta.documentId)),
    )

    expect(desglose).toHaveLength(2)
    const general = desglose.find((row) => row.taxCode === 'G')
    const exento = desglose.find((row) => row.taxCode === 'E')
    expect(general?.baseUsd).toBe(259n)
    expect(general?.ivaBaseUsd).toBe(41n)
    expect(exento?.baseUsd).toBe(200n)
    expect(exento?.ivaBaseUsd).toBe(0n)
  })

  it('LO QUE IMPORTA: los totales cuadran al céntimo en las DOS monedas', async () => {
    const venta = await createSale(db, {
      tenantId: negocio.tenantId,
      stationId: negocio.stationId,
      userId: negocio.userId,
      currency: 'USD',
      lines: [
        { productId: negocio.harina, quantity: 7000n },
        { productId: negocio.pan, quantity: 3000n },
        { productId: negocio.servicio, quantity: 1000n },
      ],
      // $28,10 en total → Bs 1.028,02 a la tasa del día.
      payments: [{ method: 'EFECTIVO_BS', amount: ves(102802n) }],
      now: AHORA,
    })

    const [doc] = await withTenant(db, negocio.tenantId, (tx) =>
      tx.select().from(schema.documents).where(eq(schema.documents.id, venta.documentId)),
    )
    if (!doc) throw new Error('sin documento')

    // El libro de ventas se lleva en bolívares aunque el negocio facture en
    // dólares. Si base + exento + IVA no da el total en Bs, el libro no suma.
    expect(doc.taxableBaseUsd + doc.exemptBaseUsd + doc.ivaBaseUsd + doc.ivaAdicionalUsd).toBe(doc.totalUsd)
    expect(doc.taxableBaseVes + doc.exemptBaseVes + doc.ivaBaseVes + doc.ivaAdicionalVes).toBe(doc.totalVes)
    expect(doc.grandTotalUsd).toBe(doc.totalUsd + doc.igtfUsd)
    expect(doc.grandTotalVes).toBe(doc.totalVes + doc.igtfVes)
  })

  it('rechaza un documento sin líneas', async () => {
    await expect(
      createSale(db, {
        tenantId: negocio.tenantId,
        stationId: negocio.stationId,
        userId: negocio.userId,
        currency: 'USD',
        lines: [],
        payments: [],
        now: AHORA,
      }),
    ).rejects.toThrow(EmptySaleError)
  })
})

describe('cobro', () => {
  it('pagar en bolívares no genera IGTF', async () => {
    const venta = await createSale(db, {
      tenantId: negocio.tenantId,
      stationId: negocio.stationId,
      userId: negocio.userId,
      currency: 'USD',
      lines: dosHarinas(),
      payments: [{ method: 'EFECTIVO_BS', amount: ves(10975n) }],
      now: AHORA,
    })
    expect(venta.settlement.igtf.amount).toBe(0n)
  })

  it('pagar en divisa cobra el IGTF, y hay que cobrar el 3% de más', async () => {
    const venta = await createSale(db, {
      tenantId: negocio.tenantId,
      stationId: negocio.stationId,
      userId: negocio.userId,
      currency: 'USD',
      lines: dosHarinas(),
      // $3,00 × 1,03 = $3,09. Cobrar solo $3,00 dejaría la caja corta.
      payments: [{ method: 'EFECTIVO_USD', amount: usd(309n) }],
      now: AHORA,
    })

    expect(venta.settlement.igtf.amount).toBe(9n)
    expect(venta.settlement.totalDue.amount).toBe(309n)
    expect(venta.settlement.balance.amount).toBe(0n)
  })

  it('guarda cada pago con su moneda y si activó IGTF', async () => {
    const venta = await createSale(db, {
      tenantId: negocio.tenantId,
      stationId: negocio.stationId,
      userId: negocio.userId,
      currency: 'USD',
      lines: dosHarinas(),
      payments: [
        { method: 'EFECTIVO_BS', amount: ves(3658n) },
        { method: 'PAGO_MOVIL', amount: ves(3658n), reference: '004512' },
        { method: 'EFECTIVO_USD', amount: usd(103n) },
      ],
      now: AHORA,
    })

    const pagos = await withTenant(db, negocio.tenantId, (tx) =>
      tx.select().from(schema.documentPayments).where(eq(schema.documentPayments.documentId, venta.documentId)),
    )

    expect(pagos).toHaveLength(3)
    expect(pagos.filter((pago) => pago.isDivisa)).toHaveLength(1)
    expect(pagos.find((pago) => pago.method === 'PAGO_MOVIL')?.reference).toBe('004512')
    expect(venta.settlement.balance.amount).toBe(0n)
  })

  it('una venta sin cubrir no se emite', async () => {
    await expect(
      createSale(db, {
        tenantId: negocio.tenantId,
        stationId: negocio.stationId,
        userId: negocio.userId,
        currency: 'USD',
        lines: dosHarinas(),
        payments: [{ method: 'EFECTIVO_BS', amount: ves(1000n) }],
        now: AHORA,
      }),
    ).rejects.toThrow(UnsettledSaleError)
  })

  it('el consecutivo no se quema con una venta que falla', async () => {
    await createSale(db, {
      tenantId: negocio.tenantId,
      stationId: negocio.stationId,
      userId: negocio.userId,
      currency: 'USD',
      lines: dosHarinas(),
      payments: [{ method: 'EFECTIVO_BS', amount: ves(10975n) }],
      now: AHORA,
    })

    await createSale(db, {
      tenantId: negocio.tenantId,
      stationId: negocio.stationId,
      userId: negocio.userId,
      currency: 'USD',
      lines: dosHarinas(),
      payments: [{ method: 'EFECTIVO_BS', amount: ves(1000n) }],
      now: AHORA,
    }).catch(() => undefined)

    const tercera = await createSale(db, {
      tenantId: negocio.tenantId,
      stationId: negocio.stationId,
      userId: negocio.userId,
      currency: 'USD',
      lines: dosHarinas(),
      payments: [{ method: 'EFECTIVO_BS', amount: ves(10975n) }],
      now: AHORA,
    })

    // La transacción completa se deshizo, así que la serie no avanzó.
    expect(tercera.fullNumber).toBe('NE-000002')
  })
})

describe('venta a crédito', () => {
  it('abre la cuenta por cobrar', async () => {
    const venta = await createSale(db, {
      tenantId: negocio.tenantId,
      stationId: negocio.stationId,
      userId: negocio.userId,
      customerId: negocio.customerId,
      currency: 'USD',
      lines: dosHarinas(),
      payments: [
        { method: 'EFECTIVO_BS', amount: ves(3658n) },
        { method: 'CREDITO', amount: usd(200n) },
      ],
      now: AHORA,
    })

    const cartera = await withTenant(db, negocio.tenantId, (tx) =>
      tx.select().from(schema.receivables).where(eq(schema.receivables.documentId, venta.documentId)),
    )

    expect(cartera).toHaveLength(1)
    expect(cartera[0]?.originalAmount).toBe(200n)
    expect(cartera[0]?.customerId).toBe(negocio.customerId)
    expect(cartera[0]?.settledAt).toBeNull()
  })

  it('exige identificar al cliente: si no, no hay a quién cobrarle', async () => {
    await expect(
      createSale(db, {
        tenantId: negocio.tenantId,
        stationId: negocio.stationId,
        userId: negocio.userId,
        currency: 'USD',
        lines: dosHarinas(),
        payments: [
          { method: 'EFECTIVO_BS', amount: ves(3658n) },
          { method: 'CREDITO', amount: usd(200n) },
        ],
        now: AHORA,
      }),
    ).rejects.toThrow(CreditRequiresCustomerError)
  })
})

describe('inventario', () => {
  it('descuenta lo vendido', async () => {
    await createSale(db, {
      tenantId: negocio.tenantId,
      stationId: negocio.stationId,
      userId: negocio.userId,
      currency: 'USD',
      lines: dosHarinas(),
      payments: [{ method: 'EFECTIVO_BS', amount: ves(10975n) }],
      now: AHORA,
    })

    expect(await stockOf(db, negocio.tenantId, negocio.harina)).toBe(-2000n)
  })

  it('un servicio no mueve inventario', async () => {
    await createSale(db, {
      tenantId: negocio.tenantId,
      stationId: negocio.stationId,
      userId: negocio.userId,
      currency: 'USD',
      lines: [{ productId: negocio.servicio, quantity: 1000n }],
      payments: [{ method: 'EFECTIVO_BS', amount: ves(42438n) }],
      now: AHORA,
    })

    expect(await stockOf(db, negocio.tenantId, negocio.servicio)).toBe(0n)
  })
})

describe('idempotencia de la sincronización', () => {
  it('reenviar la misma venta no emite dos documentos', async () => {
    const entrada = {
      tenantId: negocio.tenantId,
      stationId: negocio.stationId,
      userId: negocio.userId,
      currency: 'USD' as const,
      lines: dosHarinas(),
      payments: [{ method: 'EFECTIVO_BS' as const, amount: ves(10975n) }],
      clientRef: 'caja1-000042',
      now: AHORA,
    }

    const primera = await createSale(db, entrada)
    const segunda = await createSale(db, entrada)

    expect(segunda.deduplicated).toBe(true)
    expect(segunda.documentId).toBe(primera.documentId)
    expect(segunda.fullNumber).toBe(primera.fullNumber)
    expect(segunda.totals.total.amount).toBe(primera.totals.total.amount)

    const todos = await withTenant(db, negocio.tenantId, (tx) => tx.select().from(schema.documents))
    expect(todos).toHaveLength(1)
    // Y no descontó el inventario dos veces.
    expect(await stockOf(db, negocio.tenantId, negocio.harina)).toBe(-2000n)
  })
})

describe('anulación', () => {
  it('conserva la fila y el consecutivo, y devuelve el inventario', async () => {
    const venta = await createSale(db, {
      tenantId: negocio.tenantId,
      stationId: negocio.stationId,
      userId: negocio.userId,
      currency: 'USD',
      lines: dosHarinas(),
      payments: [{ method: 'EFECTIVO_BS', amount: ves(10975n) }],
      now: AHORA,
    })

    await voidSale(db, {
      tenantId: negocio.tenantId,
      documentId: venta.documentId,
      userId: negocio.userId,
      reason: 'El cliente se arrepintió',
      now: AHORA,
    })

    const [doc] = await withTenant(db, negocio.tenantId, (tx) =>
      tx.select().from(schema.documents).where(eq(schema.documents.id, venta.documentId)),
    )

    expect(doc?.status).toBe('VOIDED')
    // Un hueco en la numeración es lo primero que pregunta una fiscalización.
    expect(doc?.fullNumber).toBe('NE-000001')
    expect(doc?.voidReason).toBe('El cliente se arrepintió')
    expect(await stockOf(db, negocio.tenantId, negocio.harina)).toBe(0n)
  })

  it('cierra la cuenta por cobrar asociada', async () => {
    const venta = await createSale(db, {
      tenantId: negocio.tenantId,
      stationId: negocio.stationId,
      userId: negocio.userId,
      customerId: negocio.customerId,
      currency: 'USD',
      lines: dosHarinas(),
      payments: [{ method: 'CREDITO', amount: usd(300n) }],
      now: AHORA,
    })

    await voidSale(db, {
      tenantId: negocio.tenantId,
      documentId: venta.documentId,
      userId: negocio.userId,
      reason: 'Error de captura',
      now: AHORA,
    })

    const cartera = await withTenant(db, negocio.tenantId, (tx) =>
      tx.select().from(schema.receivables).where(eq(schema.receivables.documentId, venta.documentId)),
    )
    expect(cartera[0]?.settledAt).not.toBeNull()
  })

  it('no se puede anular dos veces', async () => {
    const venta = await createSale(db, {
      tenantId: negocio.tenantId,
      stationId: negocio.stationId,
      userId: negocio.userId,
      currency: 'USD',
      lines: dosHarinas(),
      payments: [{ method: 'EFECTIVO_BS', amount: ves(10975n) }],
      now: AHORA,
    })

    await voidSale(db, {
      tenantId: negocio.tenantId,
      documentId: venta.documentId,
      userId: negocio.userId,
      reason: 'primera',
      now: AHORA,
    })

    await expect(
      voidSale(db, {
        tenantId: negocio.tenantId,
        documentId: venta.documentId,
        userId: negocio.userId,
        reason: 'segunda',
        now: AHORA,
      }),
    ).rejects.toThrow(/anular un documento emitido/)
  })
})

describe('el pasado no se reescribe', () => {
  it('corregir la tasa de hoy no altera lo ya emitido', async () => {
    const venta = await createSale(db, {
      tenantId: negocio.tenantId,
      stationId: negocio.stationId,
      userId: negocio.userId,
      currency: 'USD',
      lines: dosHarinas(),
      payments: [{ method: 'EFECTIVO_BS', amount: ves(10975n) }],
      now: AHORA,
    })

    const [antes] = await withTenant(db, negocio.tenantId, (tx) =>
      tx.select().from(schema.documents).where(eq(schema.documents.id, venta.documentId)),
    )

    // Alguien la tecleó mal y la corrige. Pasa todos los días.
    await setRate(db, { tenantId: negocio.tenantId, value: '99,0000', effectiveOn: HOY })

    const [despues] = await withTenant(db, negocio.tenantId, (tx) =>
      tx.select().from(schema.documents).where(eq(schema.documents.id, venta.documentId)),
    )

    // La tasa va copiada en el documento, no solo referenciada.
    expect(despues?.rateBsPerUsd).toBe(3658420000n)
    expect(despues?.totalVes).toBe(antes?.totalVes)
  })
})

describe('presupuesto', () => {
  beforeEach(async () => {
    // seedNegocio solo crea la serie de nota de entrega; el presupuesto usa la suya.
    await withTenant(db, negocio.tenantId, (tx) =>
      tx
        .insert(schema.documentSeries)
        .values({ tenantId: negocio.tenantId, kind: 'PRESUPUESTO', prefix: 'PR', nextNumber: 1 }),
    )
  })

  it('se emite sin cobrar y sin descontar inventario', async () => {
    const antes = await stockOf(db, negocio.tenantId, negocio.harina)

    const presupuesto = await createSale(db, {
      tenantId: negocio.tenantId,
      stationId: negocio.stationId,
      userId: negocio.userId,
      kind: 'PRESUPUESTO',
      currency: 'USD',
      lines: [{ productId: negocio.harina, quantity: 2000n }],
      payments: [], // una cotización no se paga
      now: AHORA,
    })

    expect(presupuesto.fullNumber).toBe('PR-000001')
    expect(presupuesto.totals.total.amount).toBe(300n)

    const [doc] = await withTenant(db, negocio.tenantId, (tx) =>
      tx.select().from(schema.documents).where(eq(schema.documents.id, presupuesto.documentId)),
    )
    expect(doc?.status).toBe('ISSUED')

    // El inventario no se movió: sigue igual que antes.
    const despues = await stockOf(db, negocio.tenantId, negocio.harina)
    expect(despues).toBe(antes)
  })

  it('una nota de entrega sin pago sigue exigiendo saldar', async () => {
    await expect(
      createSale(db, {
        tenantId: negocio.tenantId,
        stationId: negocio.stationId,
        userId: negocio.userId,
        currency: 'USD',
        lines: [{ productId: negocio.harina, quantity: 2000n }],
        payments: [],
        now: AHORA,
      }),
    ).rejects.toThrow(UnsettledSaleError)
  })
})
