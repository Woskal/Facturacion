import { MoneyError } from './errors'

/**
 * Modos de redondeo.
 *
 * - `HALF_UP`   — el medio se aleja del cero (0,5 → 1; -0,5 → -1). Es el redondeo
 *                 comercial y el predeterminado en todo el sistema.
 * - `HALF_EVEN` — el medio va al par más cercano (redondeo bancario). Útil para
 *                 prorrateos largos donde HALF_UP acumula sesgo hacia arriba.
 * - `TRUNCATE`  — hacia cero, descarta el resto.
 * - `AWAY`      — siempre se aleja del cero si hay resto.
 */
export type RoundingMode = 'HALF_UP' | 'HALF_EVEN' | 'TRUNCATE' | 'AWAY'

export const DEFAULT_ROUNDING: RoundingMode = 'HALF_UP'

/**
 * División entera con redondeo explícito.
 *
 * Toda conversión, porcentaje y prorrateo del sistema pasa por aquí: es el único
 * punto donde se pierde precisión, y por eso el modo es siempre explícito.
 *
 * El signo se maneja por separado de la magnitud, de modo que el redondeo es
 * simétrico respecto al cero: `divideRound(-5n, 2n)` es `-3n`, igual que
 * `divideRound(5n, 2n)` es `3n`.
 */
export function divideRound(numerator: bigint, denominator: bigint, mode: RoundingMode = DEFAULT_ROUNDING): bigint {
  if (denominator === 0n) {
    throw new MoneyError('División por cero en cálculo monetario.')
  }

  const negative = numerator < 0n !== denominator < 0n
  const n = numerator < 0n ? -numerator : numerator
  const d = denominator < 0n ? -denominator : denominator

  const quotient = n / d
  const remainder = n % d

  if (remainder === 0n) {
    return negative ? -quotient : quotient
  }

  const roundUp = shouldRoundUp(quotient, remainder, d, mode)
  const magnitude = roundUp ? quotient + 1n : quotient

  return negative ? -magnitude : magnitude
}

function shouldRoundUp(quotient: bigint, remainder: bigint, divisor: bigint, mode: RoundingMode): boolean {
  switch (mode) {
    case 'TRUNCATE':
      return false
    case 'AWAY':
      return true
    case 'HALF_UP':
      return remainder * 2n >= divisor
    case 'HALF_EVEN': {
      const doubled = remainder * 2n
      if (doubled > divisor) return true
      if (doubled < divisor) return false
      // Empate exacto: se sube solo si el cociente es impar, para caer en el par.
      return quotient % 2n === 1n
    }
  }
}

/** 10^exponent como bigint. */
export function pow10(exponent: number): bigint {
  if (!Number.isInteger(exponent) || exponent < 0) {
    throw new MoneyError(`Exponente inválido para pow10: ${exponent}`)
  }
  return 10n ** BigInt(exponent)
}

/** Valor absoluto de un bigint. */
export function abs(value: bigint): bigint {
  return value < 0n ? -value : value
}
