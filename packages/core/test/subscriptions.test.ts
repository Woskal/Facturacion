import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { schema, withTenant, type Database } from '@fve/db'
import { usd, ves } from '@fve/money'

import {
  DIAS_DE_PRUEBA,
  NotPlatformAdminError,
  PRECIO_MENSUAL_POR_DEFECTO,
  createTenant,
  enforceSubscriptions,
  getSubscription,
  listSubscriptionPayments,
  listSubscriptions,
  registerSubscriptionPayment,
  setRate,
  toIsoDate,
  updateSubscription,
} from '../src/index'
import { connect, resetDatabase } from './helpers'

const HOY = new Date('2026-08-28T12:00:00Z')

let db: Database
let close: () => Promise<void>
let operador: string

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
  const [fila] = await db
    .insert(schema.users)
    .values({ email: 'op@ejemplo.ve', fullName: 'Operador', passwordHash: 'x', isPlatformAdmin: true })
    .returning({ id: schema.users.id })
  operador = fila?.id ?? ''
})

async function negocioNuevo(suffix = '1') {
  const negocio = await createTenant(db, {
    actorUserId: operador,
    name: `Bodega ${suffix}`,
    rifKind: 'J',
    rifNumber: `4000000${suffix}`,
    now: HOY,
  })
  await setRate(db, { tenantId: negocio.tenantId, value: '36,5842', effectiveOn: toIsoDate(HOY) })
  return negocio
}

/** Un día concreto, para poder razonar sobre vencimientos sin ambigüedad. */
function dia(iso: string): Date {
  return new Date(`${iso}T12:00:00Z`)
}

describe('alta y prueba gratuita', () => {
  it('el negocio nuevo arranca en prueba, sin que nadie la active', async () => {
    const negocio = await negocioNuevo()
    const suscripcion = await getSubscription(db, negocio.tenantId, HOY)

    expect(suscripcion.status).toBe('TRIAL')
    expect(suscripcion.daysLeft).toBe(DIAS_DE_PRUEBA)
    expect(suscripcion.price.amount).toBe(PRECIO_MENSUAL_POR_DEFECTO.amount)
    expect(suscripcion.period).toBe('MENSUAL')
  })

  it('se puede cambiar el plan y el precio', async () => {
    const negocio = await negocioNuevo()
    await updateSubscription(db, {
      tenantId: negocio.tenantId,
      actorUserId: operador,
      period: 'ANUAL',
      priceUsd: usd(15000n),
      graceDays: 10,
    })

    const suscripcion = await getSubscription(db, negocio.tenantId, HOY)
    expect(suscripcion.period).toBe('ANUAL')
    expect(suscripcion.price.amount).toBe(15000n)
    expect(suscripcion.graceDays).toBe(10)
  })

  it('solo el operador toca las suscripciones', async () => {
    const negocio = await negocioNuevo()
    const [comun] = await db
      .insert(schema.users)
      .values({ email: 'comun@ejemplo.ve', fullName: 'Común', passwordHash: 'x' })
      .returning({ id: schema.users.id })

    await expect(
      registerSubscriptionPayment(db, {
        tenantId: negocio.tenantId,
        actorUserId: comun?.id ?? '',
        amount: usd(1500n),
        method: 'ZELLE',
        now: HOY,
      }),
    ).rejects.toThrow(NotPlatformAdminError)
  })
})

describe('registro de pagos', () => {
  it('extiende el servicio un período', async () => {
    const negocio = await negocioNuevo()

    // La prueba vence el 12 de septiembre; un mes más lleva al 12 de octubre.
    const resultado = await registerSubscriptionPayment(db, {
      tenantId: negocio.tenantId,
      actorUserId: operador,
      amount: usd(1500n),
      method: 'ZELLE',
      reference: 'ZL-8891',
      now: HOY,
    })

    expect(resultado.status).toBe('ACTIVE')
    expect(resultado.paidThrough).toBe('2026-10-12')
  })

  it('LO QUE IMPORTA: pagar tarde no cuesta los días de retraso', async () => {
    const negocio = await negocioNuevo()

    // Vence el 12 de septiembre y paga el 14, dentro de la gracia.
    const resultado = await registerSubscriptionPayment(db, {
      tenantId: negocio.tenantId,
      actorUserId: operador,
      amount: usd(1500n),
      method: 'PAGO_MOVIL',
      reference: '004512',
      now: dia('2026-09-14'),
    })

    // El mes corre desde el 12, no desde el 14: no se le comen dos días.
    expect(resultado.paidThrough).toBe('2026-10-12')
  })

  it('pero quien estuvo meses sin pagar arranca desde hoy', async () => {
    const negocio = await negocioNuevo()

    const resultado = await registerSubscriptionPayment(db, {
      tenantId: negocio.tenantId,
      actorUserId: operador,
      amount: usd(1500n),
      method: 'ZELLE',
      now: dia('2026-12-20'),
    })

    // Regalarle los meses en que no usó el servicio sería cobrarle por nada.
    expect(resultado.paidThrough).toBe('2027-01-20')
  })

  it('varios períodos de una vez', async () => {
    const negocio = await negocioNuevo()

    const resultado = await registerSubscriptionPayment(db, {
      tenantId: negocio.tenantId,
      actorUserId: operador,
      amount: usd(4200n),
      method: 'USDT',
      periods: 3,
      now: HOY,
    })

    expect(resultado.paidThrough).toBe('2026-12-12')
  })

  it('acepta pago en bolívares y lo guarda también en dólares', async () => {
    const negocio = await negocioNuevo()

    await registerSubscriptionPayment(db, {
      tenantId: negocio.tenantId,
      actorUserId: operador,
      amount: ves(54876n),
      method: 'PAGO_MOVIL',
      reference: '004512',
      now: HOY,
    })

    const pagos = await listSubscriptionPayments(db, {
      tenantId: negocio.tenantId,
      actorUserId: operador,
    })

    expect(pagos).toHaveLength(1)
    expect(pagos[0]?.amount.currency).toBe('VES')
    expect(pagos[0]?.reference).toBe('004512')
  })

  it('deja constancia en la bitácora de quién extendió el servicio', async () => {
    const negocio = await negocioNuevo()
    await registerSubscriptionPayment(db, {
      tenantId: negocio.tenantId,
      actorUserId: operador,
      amount: usd(1500n),
      method: 'ZELLE',
      now: HOY,
    })

    const bitacora = await withTenant(db, negocio.tenantId, (tx) =>
      tx.select().from(schema.auditLog).where(eq(schema.auditLog.entity, 'subscriptions')),
    )

    // Es lo único que permite reconstruir una cobranza discutida.
    expect(bitacora).toHaveLength(1)
    expect(bitacora[0]?.actorUserId).toBe(operador)
  })
})

describe('corte por falta de pago', () => {
  it('no toca a quien está al día', async () => {
    await negocioNuevo()
    const resultado = await enforceSubscriptions(db, HOY)

    expect(resultado.revisados).toBe(1)
    expect(resultado.suspendidos).toHaveLength(0)
    expect(resultado.enGracia).toHaveLength(0)
  })

  it('marca en gracia a quien venció hace poco, sin cortarle', async () => {
    const negocio = await negocioNuevo()

    // Venció el 12 y hoy es 15: dentro de los cinco días de gracia.
    const resultado = await enforceSubscriptions(db, dia('2026-09-15'))

    expect(resultado.enGracia).toContain(negocio.tenantId)
    expect(resultado.suspendidos).toHaveLength(0)

    // El servicio sigue funcionando: quien ya transfirió no debe quedarse fuera
    // mientras alguien revisa su comprobante.
    const [fila] = await db.select().from(schema.tenants)
    expect(fila?.archivedAt).toBeNull()
  })

  it('LO QUE IMPORTA: corta pasada la gracia, pero no borra nada', async () => {
    const negocio = await negocioNuevo()

    const resultado = await enforceSubscriptions(db, dia('2026-09-25'))
    expect(resultado.suspendidos).toContain(negocio.tenantId)

    const [fila] = await db.select().from(schema.tenants)
    expect(fila?.archivedAt).not.toBeNull()

    // Los datos siguen ahí: borrarle la contabilidad a alguien por una factura
    // vencida sería indefendible.
    const alicuotas = await withTenant(db, negocio.tenantId, (tx) => tx.select().from(schema.taxRates))
    expect(alicuotas).toHaveLength(4)

    const suscripcion = await getSubscription(db, negocio.tenantId, dia('2026-09-25'))
    expect(suscripcion.status).toBe('SUSPENDED')
  })

  it('pagar devuelve el servicio', async () => {
    const negocio = await negocioNuevo()
    await enforceSubscriptions(db, dia('2026-09-25'))

    await registerSubscriptionPayment(db, {
      tenantId: negocio.tenantId,
      actorUserId: operador,
      amount: usd(1500n),
      method: 'ZELLE',
      now: dia('2026-09-26'),
    })
    await enforceSubscriptions(db, dia('2026-09-26'))

    const [fila] = await db.select().from(schema.tenants)
    expect(fila?.archivedAt).toBeNull()
    expect((await getSubscription(db, negocio.tenantId, dia('2026-09-26'))).status).toBe('ACTIVE')
  })

  it('correrlo dos veces no cambia nada', async () => {
    await negocioNuevo()
    await enforceSubscriptions(db, dia('2026-09-25'))
    const segunda = await enforceSubscriptions(db, dia('2026-09-25'))

    // Ya estaba suspendido: no vuelve a contarse como suspendido ahora.
    expect(segunda.suspendidos).toHaveLength(0)
  })
})

describe('panel de cobranza', () => {
  it('ordena por lo que vence primero: es a quién llamar hoy', async () => {
    const alDia = await negocioNuevo('1')
    const vencido = await negocioNuevo('2')

    await registerSubscriptionPayment(db, {
      tenantId: alDia.tenantId,
      actorUserId: operador,
      amount: usd(1500n),
      method: 'ZELLE',
      periods: 6,
      now: HOY,
    })

    const panel = await listSubscriptions(db, operador, HOY)

    expect(panel).toHaveLength(2)
    expect(panel[0]?.tenantId).toBe(vencido.tenantId)
    expect(panel[0]?.daysLeft).toBeLessThan(panel[1]!.daysLeft)
  })

  it('muestra el estado y el último pago', async () => {
    const negocio = await negocioNuevo()
    await registerSubscriptionPayment(db, {
      tenantId: negocio.tenantId,
      actorUserId: operador,
      amount: usd(1500n),
      method: 'ZELLE',
      now: HOY,
    })

    const panel = await listSubscriptions(db, operador, HOY)
    expect(panel[0]?.status).toBe('ACTIVE')
    expect(panel[0]?.tenantName).toBe('Bodega 1')
    expect(panel[0]?.rif).toBe('J-40000001')
    expect(panel[0]?.lastPaymentAt).not.toBeNull()
    expect(panel[0]?.suspended).toBe(false)
  })

  it('un usuario común no ve el panel de cobranza', async () => {
    const [comun] = await db
      .insert(schema.users)
      .values({ email: 'comun@ejemplo.ve', fullName: 'Común', passwordHash: 'x' })
      .returning({ id: schema.users.id })

    await expect(listSubscriptions(db, comun?.id ?? '', HOY)).rejects.toThrow(NotPlatformAdminError)
  })
})
