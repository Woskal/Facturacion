import { and, desc, eq, lte } from 'drizzle-orm'
import { schema, withTenant, type Database } from '@fve/db'
import { parseRate, type Rate } from '@fve/money'

import { CoreError } from './errors'
import type { IsoDate } from './rates'

export const BCV_URL = 'https://www.bcv.org.ve/'

/** No se pudo obtener o entender la publicación del BCV. */
export class BcvUnavailableError extends CoreError {
  override readonly name = 'BcvUnavailableError'
  constructor(reason: string) {
    super(`No se pudo leer la tasa del BCV: ${reason}`)
  }
}

export interface BcvQuote {
  /** Tasa tal como la publica el BCV, con coma decimal. */
  readonly value: string
  /**
   * Fecha valor: el día a partir del cual rige.
   *
   * NO es la fecha de publicación. El BCV publica un día la tasa que regirá el
   * siguiente día bancario, así que guardarla bajo la fecha de hoy la aplicaría
   * antes de que exista.
   */
  readonly effectiveOn: IsoDate
}

/**
 * Extrae la tasa del dólar de la página del BCV.
 *
 * Se parsea con expresiones estrictas y se valida el resultado: el contenido
 * viene de fuera y no se le concede ninguna confianza. Un número mal leído aquí
 * contaminaría todas las ventas del día.
 */
export function parseBcvHtml(html: string): BcvQuote {
  const dolarIndex = html.indexOf('id="dolar"')
  if (dolarIndex === -1) {
    throw new BcvUnavailableError('la página no trae el bloque del dólar; probablemente cambió de forma')
  }

  const block = html.slice(dolarIndex, dolarIndex + 2000)

  const valueMatch = /<strong[^>]*>\s*([\d.]+,\d+)\s*<\/strong>/.exec(block)
  if (!valueMatch?.[1]) {
    throw new BcvUnavailableError('no se encontró el valor del dólar')
  }

  const dateMatch = /content="(\d{4}-\d{2}-\d{2})T/.exec(block)
  if (!dateMatch?.[1]) {
    throw new BcvUnavailableError('no se encontró la fecha valor')
  }

  // El BCV usa punto para los miles y coma para los decimales.
  const value = valueMatch[1].replace(/\./g, '').replace(',', ',')

  // Se valida construyendo la tasa: si no es un número aceptable, revienta aquí
  // y no más adelante con un importe absurdo ya impreso en un documento.
  parseRate(value, dateMatch[1], 'BCV')

  return { value, effectiveOn: dateMatch[1] }
}

export interface FetchOptions {
  readonly url?: string | undefined
  readonly timeoutMs?: number | undefined
  readonly fetchImpl?: typeof fetch | undefined
}

/**
 * Consulta la tasa publicada por el BCV.
 *
 * El certificado del BCV es válido y verificable, así que NO se desactiva la
 * comprobación de TLS — es una costumbre extendida en integraciones con este
 * sitio y no hace falta. Sin verificación, cualquiera en la red podría dictar la
 * tasa a la que factura el negocio.
 */
export async function fetchBcvRate(options: FetchOptions = {}): Promise<BcvQuote> {
  const doFetch = options.fetchImpl ?? fetch
  const url = options.url ?? BCV_URL

  let response: Response
  try {
    response = await doFetch(url, {
      signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
      headers: { 'user-agent': 'fve-rate-sync/1.0' },
    })
  } catch (error) {
    throw new BcvUnavailableError(error instanceof Error ? error.message : 'fallo de red')
  }

  if (!response.ok) {
    throw new BcvUnavailableError(`el sitio respondió ${response.status}`)
  }

  return parseBcvHtml(await response.text())
}

export type SyncOutcome =
  | 'APPLIED'
  | 'UNCHANGED'
  | 'SKIPPED_MANUAL'
  | 'REJECTED_JUMP'

export interface SyncResult {
  readonly outcome: SyncOutcome
  readonly quote: BcvQuote
  readonly rate?: Rate | undefined
  readonly detail?: string | undefined
}

/**
 * Salto máximo que la actualización automática aplica sin intervención humana.
 *
 * Cincuenta por ciento. No es para dudar del BCV: es para que un cambio en la
 * forma de su página —que ya ha pasado— no meta un número disparatado en cada
 * venta del día sin que nadie lo note. Ante un salto mayor, la sincronización se
 * detiene y avisa; cargar la tasa a mano sigue funcionando siempre.
 */
export const DEFAULT_MAX_JUMP_BPS = 5000

/**
 * Aplica la tasa del BCV a un negocio.
 *
 * Nunca pisa una tasa cargada a mano para esa misma fecha. Si alguien la
 * corrigió, sabía algo que el proceso automático no sabe.
 */
export async function syncBcvRate(
  db: Database,
  input: {
    tenantId: string
    quote: BcvQuote
    userId?: string | undefined
    maxJumpBps?: number | undefined
  },
): Promise<SyncResult> {
  const maxJumpBps = input.maxJumpBps ?? DEFAULT_MAX_JUMP_BPS
  const incoming = parseRate(input.quote.value, input.quote.effectiveOn, 'BCV')

  return withTenant(db, input.tenantId, async (tx) => {
    const sameDay = await tx
      .select()
      .from(schema.exchangeRates)
      .where(
        and(
          eq(schema.exchangeRates.tenantId, input.tenantId),
          eq(schema.exchangeRates.effectiveOn, input.quote.effectiveOn),
        ),
      )
      .limit(1)

    const stored = sameDay[0]

    if (stored && stored.source !== 'BCV') {
      return {
        outcome: 'SKIPPED_MANUAL' as const,
        quote: input.quote,
        detail: 'ya hay una tasa cargada a mano para esa fecha',
      }
    }

    if (stored && stored.bsPerUsd === incoming.bsPerUsd) {
      return { outcome: 'UNCHANGED' as const, quote: input.quote, rate: incoming }
    }

    // Se compara contra la última tasa conocida anterior, no contra la del
    // mismo día, para detectar un salto absurdo aunque sea la primera del día.
    const previous = await tx
      .select()
      .from(schema.exchangeRates)
      .where(
        and(
          eq(schema.exchangeRates.tenantId, input.tenantId),
          lte(schema.exchangeRates.effectiveOn, input.quote.effectiveOn),
        ),
      )
      .orderBy(desc(schema.exchangeRates.effectiveOn))
      .limit(1)

    const anterior = previous[0]
    if (anterior && anterior.bsPerUsd > 0n) {
      const diff =
        incoming.bsPerUsd > anterior.bsPerUsd
          ? incoming.bsPerUsd - anterior.bsPerUsd
          : anterior.bsPerUsd - incoming.bsPerUsd
      const jumpBps = (diff * 10000n) / anterior.bsPerUsd

      if (jumpBps > BigInt(maxJumpBps)) {
        return {
          outcome: 'REJECTED_JUMP' as const,
          quote: input.quote,
          detail: `la tasa cambiaría ${Number(jumpBps) / 100}% respecto a la anterior; cárguela a mano si es correcta`,
        }
      }
    }

    await tx
      .insert(schema.exchangeRates)
      .values({
        tenantId: input.tenantId,
        bsPerUsd: incoming.bsPerUsd,
        effectiveOn: input.quote.effectiveOn,
        source: 'BCV',
        createdBy: input.userId ?? null,
      })
      .onConflictDoUpdate({
        target: [schema.exchangeRates.tenantId, schema.exchangeRates.effectiveOn],
        set: { bsPerUsd: incoming.bsPerUsd, source: 'BCV' },
      })

    return { outcome: 'APPLIED' as const, quote: input.quote, rate: incoming }
  })
}

export interface SyncAllResult {
  readonly quote: BcvQuote
  readonly applied: number
  readonly unchanged: number
  readonly skipped: number
  readonly rejected: number
}

/**
 * Actualiza la tasa en todos los negocios activos.
 *
 * Se consulta al BCV UNA vez y se reparte: son cientos de escrituras baratas
 * frente a cientos de peticiones al sitio de un banco central, que además nos
 * bloquearía con razón.
 */
export async function syncBcvRateForAllTenants(
  db: Database,
  options: FetchOptions & { quote?: BcvQuote | undefined; maxJumpBps?: number | undefined } = {},
): Promise<SyncAllResult> {
  const quote = options.quote ?? (await fetchBcvRate(options))

  const tenants = await db
    .select({ id: schema.tenants.id, archivedAt: schema.tenants.archivedAt })
    .from(schema.tenants)

  const counts = { applied: 0, unchanged: 0, skipped: 0, rejected: 0 }

  for (const tenant of tenants) {
    if (tenant.archivedAt !== null) continue

    const result = await syncBcvRate(db, {
      tenantId: tenant.id,
      quote,
      ...(options.maxJumpBps !== undefined ? { maxJumpBps: options.maxJumpBps } : {}),
    })

    if (result.outcome === 'APPLIED') counts.applied += 1
    else if (result.outcome === 'UNCHANGED') counts.unchanged += 1
    else if (result.outcome === 'SKIPPED_MANUAL') counts.skipped += 1
    else counts.rejected += 1
  }

  return { quote, ...counts }
}
