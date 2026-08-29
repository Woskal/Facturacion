import type { Currency } from './currency'
import { InvalidRateError } from './errors'
import { divideRound, pow10, DEFAULT_ROUNDING, type RoundingMode } from './rounding'
import { money, type Money } from './money'

/**
 * Decimales con que se guarda la tasa. Ocho es holgado: el BCV publica cuatro o
 * cinco y así queda margen para tasas muy altas sin perder resolución.
 */
export const RATE_DECIMALS = 8

/** Factor de escala de la tasa: 1e8. */
export const RATE_SCALE = pow10(RATE_DECIMALS)

export type RateSource = 'BCV' | 'MANUAL' | 'PARALELO'

/**
 * Tasa de cambio: cuántos bolívares vale un dólar.
 *
 * Una tasa NUNCA se guarda sola: se guarda junto a cada documento que la usó,
 * con su fecha y su origen. Un reporte histórico se reconstruye con la tasa del
 * día en que ocurrió la venta, jamás con la de hoy. Esa es la diferencia entre
 * un libro de ventas que cuadra y uno que no.
 */
export interface Rate {
  /** Bolívares por dólar, escalado 1e8. */
  readonly bsPerUsd: bigint
  /** Fecha de vigencia en formato `YYYY-MM-DD`. */
  readonly date: string
  readonly source: RateSource
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export function rate(bsPerUsdScaled: bigint, date: string, source: RateSource = 'BCV'): Rate {
  if (typeof bsPerUsdScaled !== 'bigint') {
    throw new InvalidRateError('La tasa debe ser bigint escalado 1e8.')
  }
  if (bsPerUsdScaled <= 0n) {
    throw new InvalidRateError(`La tasa debe ser mayor que cero, se recibió ${bsPerUsdScaled}.`)
  }
  if (!ISO_DATE.test(date)) {
    throw new InvalidRateError(`Fecha de tasa inválida: "${date}". Se espera YYYY-MM-DD.`)
  }
  return Object.freeze({ bsPerUsd: bsPerUsdScaled, date, source })
}

/**
 * Construye una tasa desde el decimal tal como lo publica el BCV, por ejemplo
 * `"36,58420000"` o `"36.5842"`. Se aceptan los dos separadores.
 */
export function parseRate(input: string, date: string, source: RateSource = 'BCV'): Rate {
  const raw = input.trim().replace(/\s/g, '')
  const match = /^(\d+)(?:[.,](\d+))?$/.exec(raw)
  if (!match) {
    throw new InvalidRateError(`Tasa inválida: "${input}"`)
  }
  const whole = match[1] ?? '0'
  const fraction = match[2] ?? ''
  if (fraction.length > RATE_DECIMALS) {
    throw new InvalidRateError(`La tasa "${input}" excede ${RATE_DECIMALS} decimales.`)
  }
  const scaled = BigInt(whole + fraction.padEnd(RATE_DECIMALS, '0'))
  return rate(scaled, date, source)
}

/** Representación decimal exacta de la tasa, para mostrar e imprimir. */
export function rateToDecimalString(value: Rate): string {
  const whole = value.bsPerUsd / RATE_SCALE
  const fraction = value.bsPerUsd % RATE_SCALE
  return `${whole}.${fraction.toString().padStart(RATE_DECIMALS, '0')}`
}

/**
 * Convierte un monto a otra moneda.
 *
 * Si la moneda de destino es la misma, devuelve el monto sin tocarlo — no se
 * introduce un redondeo espurio por convertir algo a sí mismo.
 */
export function convert(
  value: Money,
  target: Currency,
  exchangeRate: Rate,
  mode: RoundingMode = DEFAULT_ROUNDING,
): Money {
  if (value.currency === target) {
    return value
  }
  if (value.currency === 'USD' && target === 'VES') {
    return money('VES', divideRound(value.amount * exchangeRate.bsPerUsd, RATE_SCALE, mode))
  }
  if (value.currency === 'VES' && target === 'USD') {
    return money('USD', divideRound(value.amount * RATE_SCALE, exchangeRate.bsPerUsd, mode))
  }
  /* c8 ignore next -- inalcanzable mientras solo existan VES y USD */
  throw new InvalidRateError(`No hay conversión definida de ${value.currency} a ${target}.`)
}

/**
 * El par bimonetario que se persiste con cada monto del sistema.
 *
 * Guardar los dos montos junto con la tasa usada es redundante a propósito: es
 * lo que permite reimprimir un documento años después exactamente igual a como
 * se emitió, aunque la tasa haya cambiado mil veces.
 */
export interface DualAmount {
  readonly usd: Money
  readonly ves: Money
  readonly rate: Rate
}

export function dual(value: Money, exchangeRate: Rate, mode: RoundingMode = DEFAULT_ROUNDING): DualAmount {
  return Object.freeze({
    usd: convert(value, 'USD', exchangeRate, mode),
    ves: convert(value, 'VES', exchangeRate, mode),
    rate: exchangeRate,
  })
}

/** Extrae de un par bimonetario el monto en la moneda pedida. */
export function amountIn(value: DualAmount, currency: Currency): Money {
  return currency === 'USD' ? value.usd : value.ves
}
