import { decimalsOf, symbolOf } from './currency'
import { abs, pow10 } from './rounding'
import type { Money } from './money'
import { rateToDecimalString, type Rate } from './rate'

export interface FormatOptions {
  /** Anteponer el símbolo de la moneda. Predeterminado: sí. */
  readonly symbol?: boolean | undefined
  /** Separador de miles. Predeterminado: punto, como se escribe en Venezuela. */
  readonly groupSeparator?: string | undefined
  /** Separador decimal. Predeterminado: coma. */
  readonly decimalSeparator?: string | undefined
}

/**
 * Formatea un monto para mostrar.
 *
 * El formateo se hace a mano sobre el bigint en vez de con `Intl.NumberFormat`
 * porque este último exige un `number`, y convertir el monto a float justo antes
 * de enseñárselo al cliente anularía toda la aritmética exacta de este paquete.
 */
export function formatMoney(value: Money, options: FormatOptions = {}): string {
  const { symbol = true, groupSeparator = '.', decimalSeparator = ',' } = options

  const decimals = decimalsOf(value.currency)
  const divisor = pow10(decimals)
  const magnitude = abs(value.amount)
  const whole = (magnitude / divisor).toString()
  const fraction = (magnitude % divisor).toString().padStart(decimals, '0')

  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, groupSeparator)
  const sign = value.amount < 0n ? '-' : ''
  const digits = decimals === 0 ? grouped : `${grouped}${decimalSeparator}${fraction}`

  if (!symbol) {
    return `${sign}${digits}`
  }

  const mark = symbolOf(value.currency)
  const separator = mark.length > 1 ? ' ' : ''
  return `${sign}${mark}${separator}${digits}`
}

/** Formatea la tasa con los decimales que realmente tiene, sin ceros de relleno. */
export function formatRate(value: Rate, options: FormatOptions = {}): string {
  const { groupSeparator = '.', decimalSeparator = ',' } = options
  const decimal = rateToDecimalString(value)
  const [whole = '0', fraction = ''] = decimal.split('.')
  const trimmed = fraction.replace(/0+$/, '')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, groupSeparator)
  return trimmed === '' ? `${grouped}` : `${grouped}${decimalSeparator}${trimmed}`
}

/** Par bimonetario tal como se imprime en el documento: "Bs 1.234,56 · $33,72". */
export function formatDual(ves: Money, usd: Money, options: FormatOptions = {}): string {
  return `${formatMoney(ves, options)} · ${formatMoney(usd, options)}`
}
