import { assertCurrency, decimalsOf, type Currency } from './currency'
import { CurrencyMismatchError, InvalidAmountError } from './errors'
import { abs, divideRound, pow10, DEFAULT_ROUNDING, type RoundingMode } from './rounding'

/**
 * Un monto de dinero.
 *
 * `amount` está SIEMPRE en unidades menores (céntimos) y SIEMPRE es `bigint`.
 * Nunca se usa `number` para dinero en ninguna parte del sistema: un `number`
 * es un float de 64 bits y 0.1 + 0.2 !== 0.3. Con hiperinflación y tasas de
 * ocho decimales, ese error deja de ser teórico en cuestión de días.
 */
export interface Money {
  readonly currency: Currency
  readonly amount: bigint
}

/** Construye un monto a partir de unidades menores (céntimos). */
export function money(currency: Currency, minorUnits: bigint): Money {
  assertCurrency(currency)
  if (typeof minorUnits !== 'bigint') {
    throw new InvalidAmountError(`El monto debe ser bigint en unidades menores, se recibió ${typeof minorUnits}.`)
  }
  return Object.freeze({ currency, amount: minorUnits })
}

export function usd(minorUnits: bigint): Money {
  return money('USD', minorUnits)
}

export function ves(minorUnits: bigint): Money {
  return money('VES', minorUnits)
}

export function zero(currency: Currency): Money {
  return money(currency, 0n)
}

/**
 * Parsea un monto escrito por una persona.
 *
 * Acepta `.` o `,` como separador decimal y `.`, `,` o espacio como separador de
 * miles, porque en el mostrador se escribe de las dos formas. La desambiguación
 * es estricta a propósito: si la entrada no es interpretable de una sola manera,
 * se lanza un error en vez de adivinar. Un monto mal leído en silencio es la
 * peor clase de error que puede tener este paquete.
 *
 * Reglas:
 *  - Un único separador seguido de 1..n dígitos, con n ≤ decimales de la moneda,
 *    es el separador decimal. `"10,5"` son diez con cincuenta.
 *  - Si aparecen los dos caracteres, el último es el decimal y el otro agrupa.
 *  - Cualquier separador que no sea el decimal debe agrupar en bloques de tres
 *    exactos y sin ceros a la izquierda. `"1.234"` son mil doscientos treinta y
 *    cuatro; `"12,34,56"` y `"0,001"` son errores.
 */
export function parseMoney(input: string, currency: Currency): Money {
  assertCurrency(currency)
  const trimmed = input.trim()
  if (trimmed === '') {
    throw new InvalidAmountError('Monto vacío.')
  }

  let sign = 1n
  let body = trimmed
  if (body.startsWith('-')) {
    sign = -1n
    body = body.slice(1)
  } else if (body.startsWith('+')) {
    body = body.slice(1)
  }
  body = body.replace(/\s/g, '')

  if (body === '' || !/^[\d.,]+$/.test(body)) {
    throw new InvalidAmountError(`Monto inválido: "${input}"`)
  }

  const decimals = decimalsOf(currency)
  const dots = body.split('.').length - 1
  const commas = body.split(',').length - 1

  let decimalSeparator: string | null = null
  if (dots > 0 && commas > 0) {
    decimalSeparator = body.lastIndexOf('.') > body.lastIndexOf(',') ? '.' : ','
  } else if (dots === 1 || commas === 1) {
    const separator = dots === 1 ? '.' : ','
    const digitsAfter = body.length - body.lastIndexOf(separator) - 1
    // Si sobran dígitos para ser decimales, el separador estaba agrupando miles.
    if (digitsAfter > 0 && digitsAfter <= decimals) {
      decimalSeparator = separator
    }
  }

  let integerText = body
  let fractionText = ''
  if (decimalSeparator !== null) {
    const index = body.lastIndexOf(decimalSeparator)
    integerText = body.slice(0, index)
    fractionText = body.slice(index + 1)
    if (!/^\d+$/.test(fractionText)) {
      throw new InvalidAmountError(`Monto inválido: "${input}"`)
    }
    if (fractionText.length > decimals) {
      throw new InvalidAmountError(
        `"${input}" tiene ${fractionText.length} decimales y ${currency} admite ${decimals}. Redondee explícitamente antes de construir el monto.`,
      )
    }
  }

  const groupSeparators = new Set([...integerText].filter((char) => char === '.' || char === ','))
  if (groupSeparators.size > 1) {
    throw new InvalidAmountError(`Se mezclaron separadores de miles en "${input}".`)
  }

  let digits: string
  if (groupSeparators.size === 0) {
    if (!/^\d*$/.test(integerText)) {
      throw new InvalidAmountError(`Monto inválido: "${input}"`)
    }
    digits = integerText
  } else {
    const [separator] = groupSeparators
    /* c8 ignore next -- el Set no vacío siempre entrega un elemento */
    if (separator === undefined) throw new InvalidAmountError(`Monto inválido: "${input}"`)
    const grouped = new RegExp(`^\\d{1,3}(?:\\${separator}\\d{3})+$`)
    if (!grouped.test(integerText) || integerText.startsWith('0')) {
      throw new InvalidAmountError(
        `Agrupación de miles inválida en "${input}". Use bloques de tres dígitos, por ejemplo 1.234.567.`,
      )
    }
    digits = integerText.split(separator).join('')
  }

  if (digits === '' && fractionText === '') {
    throw new InvalidAmountError(`Monto inválido: "${input}"`)
  }

  const magnitude = BigInt((digits === '' ? '0' : digits) + fractionText.padEnd(decimals, '0'))

  return money(currency, sign * magnitude)
}

/** Representación decimal exacta, con punto como separador. Para persistir y depurar. */
export function toDecimalString(value: Money): string {
  const decimals = decimalsOf(value.currency)
  const divisor = pow10(decimals)
  const negative = value.amount < 0n
  const magnitude = abs(value.amount)
  const whole = magnitude / divisor
  const fraction = magnitude % divisor
  const sign = negative ? '-' : ''
  if (decimals === 0) return `${sign}${whole}`
  return `${sign}${whole}.${fraction.toString().padStart(decimals, '0')}`
}

// --- Operaciones ------------------------------------------------------------

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new CurrencyMismatchError(a.currency, b.currency)
  }
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b)
  return money(a.currency, a.amount + b.amount)
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b)
  return money(a.currency, a.amount - b.amount)
}

export function negate(value: Money): Money {
  return money(value.currency, -value.amount)
}

export function absolute(value: Money): Money {
  return money(value.currency, abs(value.amount))
}

/** Suma una lista. Requiere la moneda explícita para que la lista vacía tenga resultado. */
export function sum(currency: Currency, values: readonly Money[]): Money {
  return values.reduce<Money>((acc, value) => add(acc, value), zero(currency))
}

/** Multiplica por un entero exacto (por ejemplo, cantidad de unidades enteras). */
export function multiply(value: Money, factor: bigint): Money {
  return money(value.currency, value.amount * factor)
}

/**
 * Multiplica por la razón `numerator / denominator` con redondeo explícito.
 *
 * Es la primitiva de todo porcentaje del sistema: un IVA del 16% es
 * `multiplyRatio(base, 1600n, 10000n)`. Trabajar con razones enteras en vez de
 * un factor decimal evita introducir un float en el camino.
 */
export function multiplyRatio(
  value: Money,
  numerator: bigint,
  denominator: bigint,
  mode: RoundingMode = DEFAULT_ROUNDING,
): Money {
  return money(value.currency, divideRound(value.amount * numerator, denominator, mode))
}

/** Aplica un porcentaje expresado en puntos básicos (1600 bps = 16%). */
export function percentage(value: Money, basisPoints: number, mode: RoundingMode = DEFAULT_ROUNDING): Money {
  if (!Number.isInteger(basisPoints)) {
    throw new InvalidAmountError(`Los puntos básicos deben ser enteros, se recibió ${basisPoints}.`)
  }
  return multiplyRatio(value, BigInt(basisPoints), 10000n, mode)
}

// --- Comparación ------------------------------------------------------------

export function compare(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b)
  if (a.amount < b.amount) return -1
  if (a.amount > b.amount) return 1
  return 0
}

export function equals(a: Money, b: Money): boolean {
  return a.currency === b.currency && a.amount === b.amount
}

export function isZero(value: Money): boolean {
  return value.amount === 0n
}

export function isPositive(value: Money): boolean {
  return value.amount > 0n
}

export function isNegative(value: Money): boolean {
  return value.amount < 0n
}

export function max(a: Money, b: Money): Money {
  return compare(a, b) >= 0 ? a : b
}

export function min(a: Money, b: Money): Money {
  return compare(a, b) <= 0 ? a : b
}

// --- Reparto ----------------------------------------------------------------

/**
 * Reparte un monto en proporción a unos pesos, sin perder ni inventar un céntimo.
 *
 * Usa el método del mayor resto: se reparte la parte entera y los céntimos
 * sobrantes se asignan uno a uno a las partidas con mayor resto fraccionario.
 * La suma del resultado es SIEMPRE exactamente igual al monto original — esa es
 * la invariante que hace utilizable esta función para prorratear descuentos
 * entre líneas o repartir un pago entre varias facturas.
 *
 * Con pesos que suman cero, el reparto se hace en partes iguales.
 */
export function allocate(value: Money, weights: readonly bigint[]): Money[] {
  if (weights.length === 0) {
    throw new InvalidAmountError('No se puede repartir entre cero partidas.')
  }
  if (weights.some((weight) => weight < 0n)) {
    throw new InvalidAmountError('Los pesos de reparto no pueden ser negativos.')
  }

  const totalWeight = weights.reduce((acc, weight) => acc + weight, 0n)
  if (totalWeight === 0n) {
    return allocate(value, weights.map(() => 1n))
  }

  const negative = value.amount < 0n
  const magnitude = abs(value.amount)

  const shares = weights.map((weight) => (magnitude * weight) / totalWeight)
  const remainders = weights.map((weight, index) => ({
    index,
    remainder: (magnitude * weight) % totalWeight,
  }))

  let distributed = shares.reduce((acc, share) => acc + share, 0n)
  let leftover = magnitude - distributed

  // Mayor resto primero; ante empate, el índice menor, para que el reparto sea determinista.
  remainders.sort((a, b) => {
    if (a.remainder !== b.remainder) return a.remainder > b.remainder ? -1 : 1
    return a.index - b.index
  })

  for (let i = 0; leftover > 0n; i = (i + 1) % remainders.length) {
    const target = remainders[i]
    if (target === undefined) continue
    shares[target.index] = (shares[target.index] ?? 0n) + 1n
    leftover -= 1n
  }

  distributed = shares.reduce((acc, share) => acc + share, 0n)
  /* c8 ignore next 3 -- invariante defensiva: el mayor resto nunca debe fallar */
  if (distributed !== magnitude) {
    throw new InvalidAmountError('Fallo interno de reparto: la suma no coincide con el total.')
  }

  return shares.map((share) => money(value.currency, negative ? -share : share))
}

/** Reparte en `parts` partes lo más iguales posible. La suma es exacta. */
export function split(value: Money, parts: number): Money[] {
  if (!Number.isInteger(parts) || parts <= 0) {
    throw new InvalidAmountError(`Número de partes inválido: ${parts}`)
  }
  return allocate(value, Array.from({ length: parts }, () => 1n))
}

// --- Serialización ----------------------------------------------------------

/** Forma persistible/transmisible: el bigint va como string porque JSON no lo soporta. */
export interface MoneyJSON {
  readonly currency: Currency
  readonly amount: string
}

export function toJSON(value: Money): MoneyJSON {
  return { currency: value.currency, amount: value.amount.toString() }
}

export function fromJSON(value: MoneyJSON): Money {
  const currency = assertCurrency(value.currency)
  if (!/^-?\d+$/.test(value.amount)) {
    throw new InvalidAmountError(`Monto serializado inválido: "${value.amount}"`)
  }
  return money(currency, BigInt(value.amount))
}
