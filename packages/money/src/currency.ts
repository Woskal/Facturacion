import { InvalidAmountError } from './errors'

/**
 * Monedas soportadas.
 *
 * `VES` es el bolívar y `USD` el dólar. El sistema es bimonetario por diseño:
 * ninguna operación asume una moneda "principal", siempre hay que decir cuál.
 */
export const CURRENCIES = ['VES', 'USD'] as const

export type Currency = (typeof CURRENCIES)[number]

/** Cantidad de decimales de cada moneda. Ambas usan 2, pero no se asume. */
const DECIMALS: Record<Currency, number> = {
  VES: 2,
  USD: 2,
}

/** Símbolo de presentación. */
const SYMBOLS: Record<Currency, string> = {
  VES: 'Bs',
  USD: '$',
}

export function decimalsOf(currency: Currency): number {
  return DECIMALS[currency]
}

export function symbolOf(currency: Currency): string {
  return SYMBOLS[currency]
}

/** Unidades menores por unidad mayor: 100 para dos decimales. */
export function minorUnitsPerUnit(currency: Currency): bigint {
  return 10n ** BigInt(DECIMALS[currency])
}

export function isCurrency(value: unknown): value is Currency {
  return typeof value === 'string' && (CURRENCIES as readonly string[]).includes(value)
}

export function assertCurrency(value: unknown): Currency {
  if (!isCurrency(value)) {
    throw new InvalidAmountError(`Moneda desconocida: ${String(value)}`)
  }
  return value
}
