import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { schema, withTenant, type Database } from '@fve/db'
import { authenticate, listMemberships, selectTenant, verifySession } from '@fve/auth'
import { ves } from '@fve/money'

import {
  NotPlatformAdminError,
  TenantAlreadyExistsError,
  UserAlreadyExistsError,
  attachUserToTenant,
  createSale,
  createTenant,
  createUser,
  detachUserFromTenant,
  grantPlatformAdmin,
  listTenantUsers,
  listTenants,
  reactivateTenant,
  setRate,
  suspendTenant,
} from '../src/index'
import { connect, resetDatabase } from './helpers'

const HOY = '2026-08-28'
const AHORA = new Date('2026-08-28T12:00:00')
const CLAVE = 'una-clave-larga-y-decente'

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
  // El primer operador se crea fuera de la aplicación, como haría el script de
  // arranque en el servidor.
  const [row] = await db
    .insert(schema.users)
    .values({
      email: 'operador@ejemplo.ve',
      fullName: 'Operador',
      passwordHash: 'x',
      isPlatformAdmin: true,
    })
    .returning({ id: schema.users.id })
  operador = row?.id ?? ''
})

async function nuevoNegocio(suffix = '1') {
  return createTenant(db, {
    actorUserId: operador,
    name: `Bodega ${suffix}`,
    rifKind: 'J',
    rifNumber: `4000000${suffix}`,
    now: AHORA,
  })
}

describe('quién puede operar la plataforma', () => {
  it('un usuario común no puede dar de alta negocios', async () => {
    const [comun] = await db
      .insert(schema.users)
      .values({ email: 'comun@ejemplo.ve', fullName: 'Común', passwordHash: 'x' })
      .returning({ id: schema.users.id })

    await expect(
      createTenant(db, {
        actorUserId: comun?.id ?? '',
        name: 'Intento',
        rifKind: 'J',
        rifNumber: '999999999',
      }),
    ).rejects.toThrow(NotPlatformAdminError)
  })

  it('un operador archivado deja de serlo de inmediato', async () => {
    await db.update(schema.users).set({ archivedAt: AHORA }).where(eq(schema.users.id, operador))
    await expect(nuevoNegocio()).rejects.toThrow(NotPlatformAdminError)
  })

  it('un operador puede nombrar a otro', async () => {
    const { userId } = await createUser(db, {
      actorUserId: operador,
      email: 'socio@ejemplo.ve',
      fullName: 'Socio',
      password: CLAVE,
    })

    await expect(
      createTenant(db, { actorUserId: userId, name: 'x', rifKind: 'J', rifNumber: '111111111' }),
    ).rejects.toThrow(NotPlatformAdminError)

    await grantPlatformAdmin(db, { actorUserId: operador, userId })

    await expect(
      createTenant(db, { actorUserId: userId, name: 'x', rifKind: 'J', rifNumber: '111111111' }),
    ).resolves.toBeTruthy()
  })
})

describe('alta de un negocio', () => {
  it('LO QUE IMPORTA: queda listo para vender, no vacío', async () => {
    const negocio = await nuevoNegocio()

    const alicuotas = await withTenant(db, negocio.tenantId, (tx) => tx.select().from(schema.taxRates))
    const listas = await withTenant(db, negocio.tenantId, (tx) => tx.select().from(schema.priceLists))
    const cajas = await withTenant(db, negocio.tenantId, (tx) => tx.select().from(schema.stations))
    const series = await withTenant(db, negocio.tenantId, (tx) => tx.select().from(schema.documentSeries))

    // Sin esto el cliente no puede emitir ni un documento el primer día.
    expect(alicuotas.map((row) => row.code).sort()).toEqual(['E', 'G', 'R', 'S'])
    expect(alicuotas.find((row) => row.code === 'G')?.isDefault).toBe(true)
    expect(alicuotas.find((row) => row.code === 'S')?.adicionalBps).toBe(1500)
    expect(listas).toHaveLength(1)
    expect(cajas).toHaveLength(1)
    expect(series.map((row) => row.kind).sort()).toEqual([
      'FACTURA',
      'NOTA_CREDITO',
      'NOTA_ENTREGA',
      'PRESUPUESTO',
      'RECIBO',
    ])
  })

  it('no siembra catálogo: los productos los carga cada negocio', async () => {
    const negocio = await nuevoNegocio()
    const productos = await withTenant(db, negocio.tenantId, (tx) => tx.select().from(schema.products))
    expect(productos).toHaveLength(0)
  })

  it('el negocio recién creado puede vender de una vez', async () => {
    const negocio = await nuevoNegocio()
    const { userId } = await createUser(db, {
      actorUserId: operador,
      email: 'duenio@ejemplo.ve',
      fullName: 'Dueño',
      password: CLAVE,
      tenantId: negocio.tenantId,
    })

    await setRate(db, { tenantId: negocio.tenantId, value: '36,5842', effectiveOn: HOY })

    const [producto] = await withTenant(db, negocio.tenantId, async (tx) => {
      const inserted = await tx
        .insert(schema.products)
        .values({
          tenantId: negocio.tenantId,
          sku: 'HAR-1',
          name: 'Harina',
          taxRateId: negocio.taxRateIds['G'] as string,
          priceMode: 'IVA_INCLUIDO',
        })
        .returning({ id: schema.products.id })
      await tx.insert(schema.productPrices).values({
        tenantId: negocio.tenantId,
        productId: inserted[0]?.id as string,
        priceListId: negocio.priceListId,
        currency: 'USD',
        unitPrice: 150n,
      })
      return inserted
    })

    const venta = await createSale(db, {
      tenantId: negocio.tenantId,
      stationId: negocio.stationId,
      userId,
      currency: 'USD',
      lines: [{ productId: producto?.id as string, quantity: 2000n }],
      payments: [{ method: 'EFECTIVO_BS', amount: ves(10975n) }],
      now: AHORA,
    })

    expect(venta.fullNumber).toBe('NE-000001')
    expect(venta.totals.total.amount).toBe(300n)
  })

  it('no admite dos negocios con el mismo RIF', async () => {
    await nuevoNegocio()
    await expect(nuevoNegocio()).rejects.toThrow(TenantAlreadyExistsError)
  })
})

describe('cuentas asignadas a negocios', () => {
  it('la cuenta creada entra al negocio y puede iniciar sesión', async () => {
    const negocio = await nuevoNegocio()
    await createUser(db, {
      actorUserId: operador,
      email: 'duenio@ejemplo.ve',
      fullName: 'Dueño',
      password: CLAVE,
      tenantId: negocio.tenantId,
    })

    const sesion = await authenticate(db, { email: 'duenio@ejemplo.ve', password: CLAVE })
    expect(sesion.memberships).toHaveLength(1)
    expect(sesion.memberships[0]?.tenantId).toBe(negocio.tenantId)
  })

  it('una cuenta puede atender varios negocios', async () => {
    const uno = await nuevoNegocio('1')
    const dos = await nuevoNegocio('2')

    const { userId } = await createUser(db, {
      actorUserId: operador,
      email: 'contador@ejemplo.ve',
      fullName: 'Contador',
      password: CLAVE,
      tenantId: uno.tenantId,
    })
    await attachUserToTenant(db, { actorUserId: operador, userId, tenantId: dos.tenantId })

    expect(await listMemberships(db, userId)).toHaveLength(2)
  })

  it('no admite dos cuentas con el mismo correo', async () => {
    await createUser(db, { actorUserId: operador, email: 'a@ejemplo.ve', fullName: 'A', password: CLAVE })
    await expect(
      createUser(db, { actorUserId: operador, email: 'A@Ejemplo.VE', fullName: 'A', password: CLAVE }),
    ).rejects.toThrow(UserAlreadyExistsError)
  })

  it('retirar a alguien le cierra la sesión en ese negocio', async () => {
    const negocio = await nuevoNegocio()
    const { userId } = await createUser(db, {
      actorUserId: operador,
      email: 'duenio@ejemplo.ve',
      fullName: 'Dueño',
      password: CLAVE,
      tenantId: negocio.tenantId,
    })

    const sesion = await authenticate(db, { email: 'duenio@ejemplo.ve', password: CLAVE })
    await selectTenant(db, sesion.session.sessionId, negocio.tenantId)

    await detachUserFromTenant(db, { actorUserId: operador, userId, tenantId: negocio.tenantId })

    // No hay que esperar a que expire nada.
    await expect(verifySession(db, sesion.session.token)).rejects.toThrow()
    expect(await listMemberships(db, userId)).toHaveLength(0)
  })

  it('lista las cuentas de un negocio', async () => {
    const negocio = await nuevoNegocio()
    await createUser(db, {
      actorUserId: operador,
      email: 'duenio@ejemplo.ve',
      fullName: 'Dueño',
      password: CLAVE,
      tenantId: negocio.tenantId,
    })

    const cuentas = await listTenantUsers(db, operador, negocio.tenantId)
    expect(cuentas).toHaveLength(1)
    expect(cuentas[0]?.email).toBe('duenio@ejemplo.ve')
  })
})

describe('suspensión', () => {
  it('corta el acceso sin borrar nada', async () => {
    const negocio = await nuevoNegocio()
    const { userId } = await createUser(db, {
      actorUserId: operador,
      email: 'duenio@ejemplo.ve',
      fullName: 'Dueño',
      password: CLAVE,
      tenantId: negocio.tenantId,
    })

    const sesion = await authenticate(db, { email: 'duenio@ejemplo.ve', password: CLAVE })
    await selectTenant(db, sesion.session.sessionId, negocio.tenantId)

    await suspendTenant(db, { actorUserId: operador, tenantId: negocio.tenantId, now: AHORA })

    await expect(verifySession(db, sesion.session.token)).rejects.toThrow()
    // El negocio deja de aparecer, pero sus datos siguen ahí.
    expect(await listMemberships(db, userId)).toHaveLength(0)

    const alicuotas = await withTenant(db, negocio.tenantId, (tx) => tx.select().from(schema.taxRates))
    expect(alicuotas).toHaveLength(4)
  })

  it('se puede reactivar y todo vuelve', async () => {
    const negocio = await nuevoNegocio()
    const { userId } = await createUser(db, {
      actorUserId: operador,
      email: 'duenio@ejemplo.ve',
      fullName: 'Dueño',
      password: CLAVE,
      tenantId: negocio.tenantId,
    })

    await suspendTenant(db, { actorUserId: operador, tenantId: negocio.tenantId, now: AHORA })
    await reactivateTenant(db, { actorUserId: operador, tenantId: negocio.tenantId, now: AHORA })

    expect(await listMemberships(db, userId)).toHaveLength(1)
  })
})

describe('panel del operador', () => {
  it('lista los negocios con sus cuentas y su estado', async () => {
    const uno = await nuevoNegocio('1')
    await nuevoNegocio('2')
    await createUser(db, {
      actorUserId: operador,
      email: 'duenio@ejemplo.ve',
      fullName: 'Dueño',
      password: CLAVE,
      tenantId: uno.tenantId,
    })
    await suspendTenant(db, { actorUserId: operador, tenantId: uno.tenantId, now: AHORA })

    const negocios = await listTenants(db, operador)
    expect(negocios).toHaveLength(2)

    const suspendido = negocios.find((row) => row.tenantId === uno.tenantId)
    expect(suspendido?.suspended).toBe(true)
    expect(suspendido?.userCount).toBe(1)
    expect(suspendido?.rif).toBe('J-40000001')
  })

  it('un usuario común no ve el panel', async () => {
    const [comun] = await db
      .insert(schema.users)
      .values({ email: 'comun@ejemplo.ve', fullName: 'Común', passwordHash: 'x' })
      .returning({ id: schema.users.id })

    await expect(listTenants(db, comun?.id ?? '')).rejects.toThrow(NotPlatformAdminError)
  })
})

describe('rastro de las acciones del operador', () => {
  it('dar acceso a un negocio queda en su bitácora', async () => {
    const negocio = await nuevoNegocio()
    await createUser(db, {
      actorUserId: operador,
      email: 'duenio@ejemplo.ve',
      fullName: 'Dueño',
      password: CLAVE,
      tenantId: negocio.tenantId,
    })

    const bitacora = await withTenant(db, negocio.tenantId, (tx) => tx.select().from(schema.auditLog))

    // El operador puede darle acceso a quien sea, incluido a sí mismo. Lo que
    // no puede es hacerlo sin dejar rastro.
    const alta = bitacora.find((row) => row.entity === 'memberships')
    expect(alta?.actorUserId).toBe(operador)
    expect(bitacora.some((row) => row.entity === 'tenants')).toBe(true)
  })
})
