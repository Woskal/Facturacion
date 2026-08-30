import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { createDatabase, schema, type Database } from '@fve/db'
import { hashPassword } from '@fve/auth'

import { buildServer } from '../src/server'

const CLAVE = 'clave-de-prueba-larga'

let db: Database
let close: () => Promise<void>
let app: FastifyInstance
let operadorToken: string
let operadorId: string

beforeAll(async () => {
  const url = process.env['DATABASE_URL']
  if (!url) throw new Error('Falta DATABASE_URL.')
  const connection = createDatabase({ url })
  db = connection.db
  close = connection.close
  app = buildServer({ db })
  await app.ready()
})

afterAll(async () => {
  await app?.close()
  await close?.()
})

beforeEach(async () => {
  await db.execute(sql`
    TRUNCATE TABLE
      audit_log, cash_counts, cash_sessions, receivable_entries, receivables,
      expenses, expense_categories, stock_movements, document_payments,
      document_tax_breakdown, document_lines, documents, number_reservations,
      document_series, customers, product_prices, products, price_lists,
      tax_rates, exchange_rates, station_credentials, sessions, stations,
      memberships, users, tenants
    RESTART IDENTITY CASCADE
  `)

  const [operador] = await db
    .insert(schema.users)
    .values({
      email: 'operador@ejemplo.ve',
      fullName: 'Operador',
      passwordHash: await hashPassword(CLAVE),
      isPlatformAdmin: true,
    })
    .returning({ id: schema.users.id })

  operadorId = operador?.id ?? ''
  operadorToken = await login('operador@ejemplo.ve')
})

async function login(email: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email, password: CLAVE },
  })
  return response.json().token
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` }
}

/** Crea un negocio con su dueño, y devuelve un token ya posicionado en él. */
async function negocioListo(suffix = '1') {
  const creado = await app.inject({
    method: 'POST',
    url: '/platform/tenants',
    headers: auth(operadorToken),
    payload: { name: `Bodega ${suffix}`, rifKind: 'J', rifNumber: `4000000${suffix}` },
  })
  const tenant = creado.json()

  await app.inject({
    method: 'POST',
    url: '/platform/users',
    headers: auth(operadorToken),
    payload: {
      email: `duenio${suffix}@ejemplo.ve`,
      fullName: 'Dueño',
      password: CLAVE,
      tenantId: tenant.tenantId,
    },
  })

  const token = await login(`duenio${suffix}@ejemplo.ve`)
  await app.inject({
    method: 'POST',
    url: '/auth/select-tenant',
    headers: auth(token),
    payload: { tenantId: tenant.tenantId },
  })

  await app.inject({
    method: 'POST',
    url: '/rates',
    headers: auth(token),
    payload: { value: '36,5842' },
  })

  return { ...tenant, token }
}

describe('salud y sesión', () => {
  it('responde sin sesión en /health', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' })
    expect(response.statusCode).toBe(200)
  })

  it('sin token no se entra a nada', async () => {
    const response = await app.inject({ method: 'GET', url: '/products' })
    expect(response.statusCode).toBe(401)
  })

  it('con token inventado tampoco', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/products',
      headers: auth('token-inventado'),
    })
    expect(response.statusCode).toBe(401)
  })

  it('credenciales incorrectas dan 401 sin decir por qué', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'operador@ejemplo.ve', password: 'mala' },
    })
    expect(response.statusCode).toBe(401)
    expect(response.json().error).toBe('Correo o contraseña incorrectos.')
  })

  it('cerrar sesión la invalida de inmediato', async () => {
    await app.inject({ method: 'POST', url: '/auth/logout', headers: auth(operadorToken) })
    const response = await app.inject({
      method: 'GET',
      url: '/platform/tenants',
      headers: auth(operadorToken),
    })
    expect(response.statusCode).toBe(401)
  })
})

describe('el operador de la plataforma', () => {
  it('da de alta un negocio listo para vender', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/platform/tenants',
      headers: auth(operadorToken),
      payload: { name: 'Bodega Nueva', rifKind: 'J', rifNumber: '408887777' },
    })

    expect(response.statusCode).toBe(201)
    const body = response.json()
    expect(body.stationId).toBeTruthy()
    expect(Object.keys(body.taxRateIds).sort()).toEqual(['E', 'G', 'R', 'S'])
    expect(Object.keys(body.seriesIds)).toHaveLength(4)
  })

  it('un usuario de negocio no puede usar el panel', async () => {
    const negocio = await negocioListo()
    const response = await app.inject({
      method: 'GET',
      url: '/platform/tenants',
      headers: auth(negocio.token),
    })
    expect(response.statusCode).toBe(403)
  })

  it('suspender corta el acceso al instante', async () => {
    const negocio = await negocioListo()

    await app.inject({
      method: 'POST',
      url: `/platform/tenants/${negocio.tenantId}/suspend`,
      headers: auth(operadorToken),
    })

    const response = await app.inject({ method: 'GET', url: '/products', headers: auth(negocio.token) })
    expect(response.statusCode).toBe(401)
  })

  it('rechaza un RIF repetido con 409', async () => {
    const payload = { name: 'Otra', rifKind: 'J', rifNumber: '409998888' }
    await app.inject({ method: 'POST', url: '/platform/tenants', headers: auth(operadorToken), payload })
    const response = await app.inject({
      method: 'POST',
      url: '/platform/tenants',
      headers: auth(operadorToken),
      payload,
    })
    expect(response.statusCode).toBe(409)
  })
})

describe('selección de negocio', () => {
  it('sin negocio activo las rutas de negocio dan 403', async () => {
    await app.inject({
      method: 'POST',
      url: '/platform/tenants',
      headers: auth(operadorToken),
      payload: { name: 'Bodega', rifKind: 'J', rifNumber: '401112222' },
    })
    await app.inject({
      method: 'POST',
      url: '/platform/users',
      headers: auth(operadorToken),
      payload: { email: 'nuevo@ejemplo.ve', fullName: 'Nuevo', password: CLAVE },
    })

    const token = await login('nuevo@ejemplo.ve')
    const response = await app.inject({ method: 'GET', url: '/products', headers: auth(token) })
    expect(response.statusCode).toBe(403)
  })

  it('no se puede entrar a un negocio ajeno', async () => {
    const propio = await negocioListo('1')
    const ajeno = await negocioListo('2')

    const response = await app.inject({
      method: 'POST',
      url: '/auth/select-tenant',
      headers: auth(propio.token),
      payload: { tenantId: ajeno.tenantId },
    })
    expect(response.statusCode).toBe(403)
  })
})

describe('catálogo por HTTP', () => {
  it('crea un producto y lo encuentra', async () => {
    const negocio = await negocioListo()

    const creado = await app.inject({
      method: 'POST',
      url: '/products',
      headers: auth(negocio.token),
      payload: {
        sku: 'HAR-1',
        name: 'Harina de maíz',
        taxRateId: negocio.taxRateIds.G,
        price: { currency: 'USD', amount: '150' },
        initialStock: '20000',
      },
    })
    expect(creado.statusCode).toBe(201)

    const listado = await app.inject({
      method: 'GET',
      url: '/products?q=Harina',
      headers: auth(negocio.token),
    })

    const producto = listado.json().products[0]
    // Los montos viajan como texto en unidades menores, nunca como número.
    expect(producto.price).toEqual({ currency: 'USD', amount: '150' })
    expect(producto.stock).toBe('20000')
  })

  it('rechaza datos inválidos con 400 y explica qué campo', async () => {
    const negocio = await negocioListo()
    const response = await app.inject({
      method: 'POST',
      url: '/products',
      headers: auth(negocio.token),
      payload: { sku: 'X', name: 'X', taxRateId: 'no-es-uuid', price: { currency: 'USD', amount: '1' } },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json().details[0].path).toBe('taxRateId')
  })

  it('un monto con decimales se rechaza: las unidades son enteras', async () => {
    const negocio = await negocioListo()
    const response = await app.inject({
      method: 'POST',
      url: '/products',
      headers: auth(negocio.token),
      payload: {
        sku: 'X',
        name: 'X',
        taxRateId: negocio.taxRateIds.G,
        price: { currency: 'USD', amount: '1.50' },
      },
    })
    expect(response.statusCode).toBe(400)
  })
})

describe('venta por HTTP', () => {
  async function conProducto(negocio: Awaited<ReturnType<typeof negocioListo>>) {
    const creado = await app.inject({
      method: 'POST',
      url: '/products',
      headers: auth(negocio.token),
      payload: {
        sku: 'HAR-1',
        name: 'Harina de maíz',
        taxRateId: negocio.taxRateIds.G,
        price: { currency: 'USD', amount: '150' },
        initialStock: '20000',
      },
    })
    return creado.json().productId as string
  }

  it('emite y devuelve totales exactos en texto', async () => {
    const negocio = await negocioListo()
    const productId = await conProducto(negocio)

    const response = await app.inject({
      method: 'POST',
      url: '/sales',
      headers: auth(negocio.token),
      payload: {
        stationId: negocio.stationId,
        currency: 'USD',
        lines: [{ productId, quantity: '2000' }],
        payments: [{ method: 'EFECTIVO_BS', amount: { currency: 'VES', amount: '10975' } }],
      },
    })

    expect(response.statusCode).toBe(201)
    const venta = response.json()
    expect(venta.fullNumber).toBe('NE-000001')
    expect(venta.totals.total).toEqual({ currency: 'USD', amount: '300' })
    expect(venta.totals.base).toEqual({ currency: 'USD', amount: '259' })
    expect(venta.settlement.igtf).toEqual({ currency: 'USD', amount: '0' })
  })

  it('pagar en divisa cobra IGTF', async () => {
    const negocio = await negocioListo()
    const productId = await conProducto(negocio)

    const response = await app.inject({
      method: 'POST',
      url: '/sales',
      headers: auth(negocio.token),
      payload: {
        stationId: negocio.stationId,
        currency: 'USD',
        lines: [{ productId, quantity: '2000' }],
        payments: [{ method: 'EFECTIVO_USD', amount: { currency: 'USD', amount: '309' } }],
      },
    })

    expect(response.json().settlement.igtf).toEqual({ currency: 'USD', amount: '9' })
    expect(response.json().settlement.totalDue).toEqual({ currency: 'USD', amount: '309' })
  })

  it('una venta sin cubrir da 422 y explica cuánto falta', async () => {
    const negocio = await negocioListo()
    const productId = await conProducto(negocio)

    const response = await app.inject({
      method: 'POST',
      url: '/sales',
      headers: auth(negocio.token),
      payload: {
        stationId: negocio.stationId,
        currency: 'USD',
        lines: [{ productId, quantity: '2000' }],
        payments: [{ method: 'EFECTIVO_BS', amount: { currency: 'VES', amount: '1000' } }],
      },
    })

    expect(response.statusCode).toBe(422)
    expect(response.json().error).toMatch(/saldo pendiente/)
  })

  it('LO QUE IMPORTA: reenviar la misma venta no emite dos documentos', async () => {
    const negocio = await negocioListo()
    const productId = await conProducto(negocio)

    const payload = {
      stationId: negocio.stationId,
      currency: 'USD',
      clientRef: 'caja1-000042',
      lines: [{ productId, quantity: '2000' }],
      payments: [{ method: 'EFECTIVO_BS', amount: { currency: 'VES', amount: '10975' } }],
    }

    const primera = await app.inject({ method: 'POST', url: '/sales', headers: auth(negocio.token), payload })
    const segunda = await app.inject({ method: 'POST', url: '/sales', headers: auth(negocio.token), payload })

    expect(primera.statusCode).toBe(201)
    // 200, no 201: no se creó nada nuevo.
    expect(segunda.statusCode).toBe(200)
    expect(segunda.json().deduplicated).toBe(true)
    expect(segunda.json().documentId).toBe(primera.json().documentId)
  })

  it('anular conserva el documento', async () => {
    const negocio = await negocioListo()
    const productId = await conProducto(negocio)

    const venta = await app.inject({
      method: 'POST',
      url: '/sales',
      headers: auth(negocio.token),
      payload: {
        stationId: negocio.stationId,
        currency: 'USD',
        lines: [{ productId, quantity: '2000' }],
        payments: [{ method: 'EFECTIVO_BS', amount: { currency: 'VES', amount: '10975' } }],
      },
    })

    const anulada = await app.inject({
      method: 'POST',
      url: `/sales/${venta.json().documentId}/void`,
      headers: auth(negocio.token),
      payload: { reason: 'Error de captura' },
    })

    expect(anulada.statusCode).toBe(204)
  })
})

describe('bloques de numeración por HTTP', () => {
  it('aparta un bloque y lo saca de la serie', async () => {
    const negocio = await negocioListo()

    const reservado = await app.inject({
      method: 'POST',
      url: `/stations/${negocio.stationId}/number-blocks`,
      headers: auth(negocio.token),
      payload: { count: 5 },
    })

    expect(reservado.statusCode).toBe(201)
    expect(reservado.json().block.from).toBe(1)
    expect(reservado.json().block.to).toBe(5)

    const listado = await app.inject({
      method: 'GET',
      url: `/stations/${negocio.stationId}/number-blocks`,
      headers: auth(negocio.token),
    })
    expect(listado.json().blocks).toHaveLength(1)
  })

  it('LO QUE IMPORTA: una venta sin conexión sube con su número apartado', async () => {
    const negocio = await negocioListo()
    const creado = await app.inject({
      method: 'POST',
      url: '/products',
      headers: auth(negocio.token),
      payload: {
        sku: 'HAR-1',
        name: 'Harina',
        taxRateId: negocio.taxRateIds.G,
        price: { currency: 'USD', amount: '150' },
        initialStock: '20000',
      },
    })

    await app.inject({
      method: 'POST',
      url: `/stations/${negocio.stationId}/number-blocks`,
      headers: auth(negocio.token),
      payload: { count: 5 },
    })

    const venta = await app.inject({
      method: 'POST',
      url: '/sales',
      headers: auth(negocio.token),
      payload: {
        stationId: negocio.stationId,
        currency: 'USD',
        reservedNumber: 3,
        clientRef: 'caja1-offline-3',
        lines: [{ productId: creado.json().productId, quantity: '2000' }],
        payments: [{ method: 'EFECTIVO_BS', amount: { currency: 'VES', amount: '10975' } }],
      },
    })

    expect(venta.statusCode).toBe(201)
    expect(venta.json().fullNumber).toBe('NE-000003')
  })

  it('un número fuera del bloque se rechaza con 422', async () => {
    const negocio = await negocioListo()
    const creado = await app.inject({
      method: 'POST',
      url: '/products',
      headers: auth(negocio.token),
      payload: {
        sku: 'HAR-1',
        name: 'Harina',
        taxRateId: negocio.taxRateIds.G,
        price: { currency: 'USD', amount: '150' },
      },
    })

    const venta = await app.inject({
      method: 'POST',
      url: '/sales',
      headers: auth(negocio.token),
      payload: {
        stationId: negocio.stationId,
        currency: 'USD',
        reservedNumber: 99,
        lines: [{ productId: creado.json().productId, quantity: '2000' }],
        payments: [{ method: 'EFECTIVO_BS', amount: { currency: 'VES', amount: '10975' } }],
      },
    })

    expect(venta.statusCode).toBe(422)
    expect(venta.json().error).toMatch(/no pertenece a ningún bloque/)
  })
})

describe('caja por HTTP', () => {
  it('abre, vende y cierra con arqueo', async () => {
    const negocio = await negocioListo()

    const creado = await app.inject({
      method: 'POST',
      url: '/products',
      headers: auth(negocio.token),
      payload: {
        sku: 'HAR-1',
        name: 'Harina',
        taxRateId: negocio.taxRateIds.G,
        price: { currency: 'USD', amount: '150' },
        initialStock: '20000',
      },
    })

    const abierta = await app.inject({
      method: 'POST',
      url: '/cash/open',
      headers: auth(negocio.token),
      payload: {
        stationId: negocio.stationId,
        opening: [{ method: 'EFECTIVO_BS', currency: 'VES', amount: '10000' }],
      },
    })
    expect(abierta.statusCode).toBe(201)

    await app.inject({
      method: 'POST',
      url: '/sales',
      headers: auth(negocio.token),
      payload: {
        stationId: negocio.stationId,
        currency: 'USD',
        lines: [{ productId: creado.json().productId, quantity: '2000' }],
        payments: [{ method: 'EFECTIVO_BS', amount: { currency: 'VES', amount: '10975' } }],
      },
    })

    const cerrada = await app.inject({
      method: 'POST',
      url: `/cash/${abierta.json().sessionId}/close`,
      headers: auth(negocio.token),
      payload: { counted: [{ method: 'EFECTIVO_BS', currency: 'VES', amount: '20975' }] },
    })

    const linea = cerrada.json().session.lines.find((row: { method: string }) => row.method === 'EFECTIVO_BS')
    expect(linea.expected).toEqual({ currency: 'VES', amount: '20975' })
    expect(linea.difference).toEqual({ currency: 'VES', amount: '0' })
  })

  it('no se abren dos turnos en la misma caja', async () => {
    const negocio = await negocioListo()
    const payload = { stationId: negocio.stationId }
    await app.inject({ method: 'POST', url: '/cash/open', headers: auth(negocio.token), payload })
    const segunda = await app.inject({ method: 'POST', url: '/cash/open', headers: auth(negocio.token), payload })
    expect(segunda.statusCode).toBe(422)
  })
})

describe('cobranza por HTTP', () => {
  it('el negocio nuevo aparece en prueba', async () => {
    const negocio = await negocioListo()

    const panel = await app.inject({
      method: 'GET',
      url: '/platform/subscriptions',
      headers: auth(operadorToken),
    })

    const fila = panel.json().subscriptions.find((s: { tenantId: string }) => s.tenantId === negocio.tenantId)
    expect(fila.status).toBe('TRIAL')
    expect(fila.daysLeft).toBe(15)
  })

  it('LO QUE IMPORTA: registrar un pago extiende el servicio', async () => {
    const negocio = await negocioListo()

    const pago = await app.inject({
      method: 'POST',
      url: `/platform/tenants/${negocio.tenantId}/subscription/payments`,
      headers: auth(operadorToken),
      payload: {
        amount: { currency: 'USD', amount: '1500' },
        method: 'ZELLE',
        reference: 'ZL-8891',
      },
    })

    expect(pago.statusCode).toBe(201)
    expect(pago.json().subscription.status).toBe('ACTIVE')
    expect(pago.json().subscription.daysLeft).toBeGreaterThan(30)
  })

  it('el negocio ve su propia suscripción pero no la de nadie más', async () => {
    const negocio = await negocioListo()

    const propia = await app.inject({ method: 'GET', url: '/subscription', headers: auth(negocio.token) })
    expect(propia.statusCode).toBe(200)
    expect(propia.json().subscription.status).toBe('TRIAL')

    const ajena = await app.inject({
      method: 'GET',
      url: '/platform/subscriptions',
      headers: auth(negocio.token),
    })
    expect(ajena.statusCode).toBe(403)
  })

  it('se puede cambiar el plan', async () => {
    const negocio = await negocioListo()

    const cambio = await app.inject({
      method: 'PATCH',
      url: `/platform/tenants/${negocio.tenantId}/subscription`,
      headers: auth(operadorToken),
      payload: { period: 'ANUAL', priceUsd: { currency: 'USD', amount: '15000' } },
    })

    expect(cambio.statusCode).toBe(204)

    const propia = await app.inject({ method: 'GET', url: '/subscription', headers: auth(negocio.token) })
    expect(propia.json().subscription.period).toBe('ANUAL')
    expect(propia.json().subscription.price).toEqual({ currency: 'USD', amount: '15000' })
  })
})

describe('aislamiento por HTTP', () => {
  it('LO QUE IMPORTA: un negocio no ve el catálogo del otro', async () => {
    const uno = await negocioListo('1')
    const dos = await negocioListo('2')

    await app.inject({
      method: 'POST',
      url: '/products',
      headers: auth(uno.token),
      payload: {
        sku: 'SOLO-UNO',
        name: 'Producto del primero',
        taxRateId: uno.taxRateIds.G,
        price: { currency: 'USD', amount: '100' },
      },
    })

    const desdeDos = await app.inject({ method: 'GET', url: '/products', headers: auth(dos.token) })
    expect(desdeDos.json().products).toHaveLength(0)

    const desdeUno = await app.inject({ method: 'GET', url: '/products', headers: auth(uno.token) })
    expect(desdeUno.json().products).toHaveLength(1)
  })

  it('el operador tampoco ve datos de negocio sin membresía', async () => {
    const negocio = await negocioListo()
    await app.inject({
      method: 'POST',
      url: '/products',
      headers: auth(negocio.token),
      payload: {
        sku: 'X',
        name: 'X',
        taxRateId: negocio.taxRateIds.G,
        price: { currency: 'USD', amount: '100' },
      },
    })

    // El operador no eligió negocio: no hay contexto y no hay datos.
    const response = await app.inject({ method: 'GET', url: '/products', headers: auth(operadorToken) })
    expect(response.statusCode).toBe(403)
    expect(operadorId).toBeTruthy()
  })
})
