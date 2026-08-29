import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { schema, withTenant, type Database } from '@fve/db'

import {
  BcvUnavailableError,
  fetchBcvRate,
  getRateFor,
  parseBcvHtml,
  setRate,
  syncBcvRate,
  syncBcvRateForAllTenants,
} from '../src/index'
import { connect, resetDatabase, seedNegocio, type Negocio } from './helpers'

/** Recorte real de la portada del BCV. */
const PAGINA = readFileSync(resolve(__dirname, 'fixtures-bcv.html'), 'utf8')

const FECHA_VALOR = '2026-08-31'
const VALOR = '794,99170000'

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
})

function respuesta(body: string, status = 200): typeof fetch {
  return (async () => new Response(body, { status })) as unknown as typeof fetch
}

describe('lectura de la publicación del BCV', () => {
  it('extrae el valor y la fecha de la página real', () => {
    const cotizacion = parseBcvHtml(PAGINA)
    expect(cotizacion.value).toBe(VALOR)
    expect(cotizacion.effectiveOn).toBe(FECHA_VALOR)
  })

  it('LO QUE IMPORTA: la fecha es la FECHA VALOR, no la de publicación', () => {
    // El BCV publica un día la tasa que rige el siguiente día bancario. Guardarla
    // bajo la fecha de hoy la aplicaría antes de que exista.
    const cotizacion = parseBcvHtml(PAGINA)
    expect(cotizacion.effectiveOn).toBe('2026-08-31')
  })

  it('rechaza una página que cambió de forma en vez de adivinar', () => {
    expect(() => parseBcvHtml('<html><body>otra cosa</body></html>')).toThrow(BcvUnavailableError)
  })

  it('rechaza un bloque sin número reconocible', () => {
    expect(() => parseBcvHtml('<div id="dolar"><strong>sin número</strong></div>')).toThrow(
      BcvUnavailableError,
    )
  })

  it('rechaza un bloque sin fecha valor', () => {
    expect(() => parseBcvHtml('<div id="dolar"><strong>794,99</strong></div>')).toThrow(
      BcvUnavailableError,
    )
  })

  it('convierte los separadores del BCV: punto de miles, coma decimal', () => {
    const html = `<div id="dolar"><strong class="strong-tb">1.234,56780000</strong>
      <span content="2026-08-31T00:00:00-04:00">x</span></div>`
    expect(parseBcvHtml(html).value).toBe('1234,56780000')
  })
})

describe('consulta al sitio', () => {
  it('devuelve la cotización cuando responde bien', async () => {
    const cotizacion = await fetchBcvRate({ fetchImpl: respuesta(PAGINA) })
    expect(cotizacion.value).toBe(VALOR)
  })

  it('un error del sitio no revienta con algo incomprensible', async () => {
    await expect(fetchBcvRate({ fetchImpl: respuesta('', 503) })).rejects.toThrow(/respondió 503/)
  })

  it('un fallo de red se reporta como tal', async () => {
    const fallo = (async () => {
      throw new Error('getaddrinfo ENOTFOUND')
    }) as unknown as typeof fetch
    await expect(fetchBcvRate({ fetchImpl: fallo })).rejects.toThrow(BcvUnavailableError)
  })
})

describe('aplicación al negocio', () => {
  const cotizacion = { value: VALOR, effectiveOn: FECHA_VALOR }

  it('carga la tasa y queda disponible para vender', async () => {
    const resultado = await syncBcvRate(db, { tenantId: negocio.tenantId, quote: cotizacion })

    expect(resultado.outcome).toBe('APPLIED')
    const guardada = await getRateFor(db, negocio.tenantId, FECHA_VALOR)
    expect(guardada.bsPerUsd).toBe(79499170000n)
    expect(guardada.source).toBe('BCV')
  })

  it('correr dos veces no cambia nada', async () => {
    await syncBcvRate(db, { tenantId: negocio.tenantId, quote: cotizacion })
    const segunda = await syncBcvRate(db, { tenantId: negocio.tenantId, quote: cotizacion })
    expect(segunda.outcome).toBe('UNCHANGED')
  })

  it('LO QUE IMPORTA: nunca pisa una tasa cargada a mano', async () => {
    await setRate(db, {
      tenantId: negocio.tenantId,
      value: '800,0000',
      effectiveOn: FECHA_VALOR,
      source: 'MANUAL',
    })

    const resultado = await syncBcvRate(db, { tenantId: negocio.tenantId, quote: cotizacion })

    // Quien la corrigió sabía algo que el proceso automático no sabe.
    expect(resultado.outcome).toBe('SKIPPED_MANUAL')
    expect((await getRateFor(db, negocio.tenantId, FECHA_VALOR)).bsPerUsd).toBe(80000000000n)
  })

  it('se planta ante un salto disparatado en vez de contaminar el día', async () => {
    await setRate(db, {
      tenantId: negocio.tenantId,
      value: '36,5842',
      effectiveOn: '2026-08-30',
      source: 'BCV',
    })

    // 36 → 794 es un salto de más de veinte veces: huele a página mal leída.
    const resultado = await syncBcvRate(db, { tenantId: negocio.tenantId, quote: cotizacion })

    expect(resultado.outcome).toBe('REJECTED_JUMP')
    expect(resultado.detail).toMatch(/cárguela a mano/)
  })

  it('un salto grande se puede aceptar subiendo el límite a propósito', async () => {
    await setRate(db, {
      tenantId: negocio.tenantId,
      value: '36,5842',
      effectiveOn: '2026-08-30',
      source: 'BCV',
    })

    const resultado = await syncBcvRate(db, {
      tenantId: negocio.tenantId,
      quote: cotizacion,
      maxJumpBps: 1_000_000,
    })
    expect(resultado.outcome).toBe('APPLIED')
  })

  it('una variación normal sí se aplica sola', async () => {
    await setRate(db, {
      tenantId: negocio.tenantId,
      value: '780,0000',
      effectiveOn: '2026-08-30',
      source: 'BCV',
    })

    const resultado = await syncBcvRate(db, { tenantId: negocio.tenantId, quote: cotizacion })
    expect(resultado.outcome).toBe('APPLIED')
  })
})

describe('reparto a todos los negocios', () => {
  it('consulta al BCV una sola vez y escribe en cada negocio activo', async () => {
    const otro = await seedNegocio(db, '2')

    let consultas = 0
    const contando = (async () => {
      consultas += 1
      return new Response(PAGINA, { status: 200 })
    }) as unknown as typeof fetch

    const resultado = await syncBcvRateForAllTenants(db, { fetchImpl: contando })

    // Cientos de escrituras baratas, no cientos de peticiones a un banco central.
    expect(consultas).toBe(1)
    expect(resultado.applied).toBe(2)
    expect((await getRateFor(db, otro.tenantId, FECHA_VALOR)).bsPerUsd).toBe(79499170000n)
  })

  it('no toca los negocios suspendidos', async () => {
    await db.update(schema.tenants).set({ archivedAt: new Date() })

    const resultado = await syncBcvRateForAllTenants(db, { fetchImpl: respuesta(PAGINA) })
    expect(resultado.applied).toBe(0)
  })

  it('cuenta por separado lo aplicado y lo omitido', async () => {
    const otro = await seedNegocio(db, '2')
    await setRate(db, {
      tenantId: otro.tenantId,
      value: '800,0000',
      effectiveOn: FECHA_VALOR,
      source: 'MANUAL',
    })

    const resultado = await syncBcvRateForAllTenants(db, { fetchImpl: respuesta(PAGINA) })
    expect(resultado.applied).toBe(1)
    expect(resultado.skipped).toBe(1)

    const tasas = await withTenant(db, otro.tenantId, (tx) => tx.select().from(schema.exchangeRates))
    expect(tasas.find((row) => row.effectiveOn === FECHA_VALOR)?.source).toBe('MANUAL')
  })
})
