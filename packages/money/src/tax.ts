import type { Currency } from './currency'
import { InvalidTaxError } from './errors'
import { DEFAULT_ROUNDING, divideRound, type RoundingMode } from './rounding'
import { add, allocate, money, percentage, subtract, sum, zero, type Money } from './money'

// --- Alícuotas de IVA -------------------------------------------------------

/**
 * Una alícuota de IVA.
 *
 * La alícuota suntuaria no es "31%": es el 16% general MÁS una alícuota
 * adicional del 15%. El libro de ventas las exige desglosadas, así que se
 * modelan separadas desde el principio en vez de sumarlas y tener que
 * desarmarlas después.
 *
 * Las tasas son parámetros, no constantes del código: han cambiado por decreto
 * y volverán a cambiar. Un cliente puede tener su propio catálogo de alícuotas.
 */
export interface Alicuota {
  readonly codigo: string
  readonly nombre: string
  /** Alícuota principal en puntos básicos (1600 = 16%). */
  readonly baseBps: number
  /** Alícuota adicional en puntos básicos (1500 = 15% suntuario). */
  readonly adicionalBps: number
}

export function alicuota(codigo: string, nombre: string, baseBps: number, adicionalBps = 0): Alicuota {
  if (!Number.isInteger(baseBps) || baseBps < 0) {
    throw new InvalidTaxError(`Alícuota base inválida para "${codigo}": ${baseBps}`)
  }
  if (!Number.isInteger(adicionalBps) || adicionalBps < 0) {
    throw new InvalidTaxError(`Alícuota adicional inválida para "${codigo}": ${adicionalBps}`)
  }
  return Object.freeze({ codigo, nombre, baseBps, adicionalBps })
}

/** Catálogo vigente al momento de escribir. Es un valor por defecto, no una ley grabada en piedra. */
export const ALICUOTAS = Object.freeze({
  GENERAL: alicuota('G', 'General 16%', 1600),
  REDUCIDA: alicuota('R', 'Reducida 8%', 800),
  SUNTUARIA: alicuota('S', 'General 16% + adicional 15%', 1600, 1500),
  EXENTO: alicuota('E', 'Exento', 0),
} satisfies Record<string, Alicuota>)

export function totalBps(value: Alicuota): number {
  return value.baseBps + value.adicionalBps
}

// --- Líneas de documento ----------------------------------------------------

/**
 * Si el precio del catálogo ya trae el IVA adentro o no.
 *
 * En el detal venezolano se muestra el precio con IVA incluido; en mayor se
 * factura sin IVA y se agrega al final. El sistema soporta ambos porque los dos
 * son la práctica normal según el negocio.
 */
export type PriceMode = 'IVA_INCLUIDO' | 'IVA_EXCLUIDO'

/** Escala de la cantidad: milésimas, para poder vender 0,750 kg. */
export const QUANTITY_SCALE = 1000n

export interface LineInput {
  /** Cantidad en milésimas: 1500n son 1,5 unidades. */
  readonly quantity: bigint
  readonly unitPrice: Money
  readonly alicuota: Alicuota
  readonly priceMode: PriceMode
  /** Descuento de línea en puntos básicos (500 = 5%). */
  readonly discountBps?: number
}

export interface LineResult {
  readonly currency: Currency
  readonly alicuota: Alicuota
  /** Precio por cantidad, antes de descuento. */
  readonly gross: Money
  readonly discount: Money
  /** Base imponible, ya sin IVA y con el descuento aplicado. */
  readonly base: Money
  readonly ivaBase: Money
  readonly ivaAdicional: Money
  readonly ivaTotal: Money
  readonly total: Money
}

/**
 * Calcula una línea de documento.
 *
 * En modo IVA incluido, el total de la línea es exactamente el precio que vio
 * el cliente: la base se despeja hacia atrás y el IVA es la diferencia. Eso
 * garantiza que no aparezca un céntimo de más al pagar, que es la queja
 * número uno contra los sistemas mal hechos.
 */
export function computeLine(input: LineInput, mode: RoundingMode = DEFAULT_ROUNDING): LineResult {
  if (input.quantity < 0n) {
    throw new InvalidTaxError('La cantidad de una línea no puede ser negativa.')
  }
  const discountBps = input.discountBps ?? 0
  if (!Number.isInteger(discountBps) || discountBps < 0 || discountBps > 10000) {
    throw new InvalidTaxError(`Descuento inválido: ${discountBps} bps. Debe estar entre 0 y 10000.`)
  }

  const currency = input.unitPrice.currency
  const gross = money(currency, divideRound(input.unitPrice.amount * input.quantity, QUANTITY_SCALE, mode))
  const discount = percentage(gross, discountBps, mode)
  const net = subtract(gross, discount)

  const bps = totalBps(input.alicuota)

  let base: Money
  let ivaBase: Money
  let ivaAdicional: Money

  if (input.priceMode === 'IVA_EXCLUIDO') {
    base = net
    ivaBase = percentage(base, input.alicuota.baseBps, mode)
    ivaAdicional = percentage(base, input.alicuota.adicionalBps, mode)
  } else {
    // Despeje: base = net / (1 + tasa).
    base = money(currency, divideRound(net.amount * 10000n, BigInt(10000 + bps), mode))
    const ivaTotal = subtract(net, base)
    // El IVA embebido se reparte entre principal y adicional sin perder céntimos.
    const parts = allocate(ivaTotal, [BigInt(input.alicuota.baseBps), BigInt(input.alicuota.adicionalBps)])
    ivaBase = parts[0] ?? zero(currency)
    ivaAdicional = parts[1] ?? zero(currency)
    if (bps === 0) {
      ivaBase = zero(currency)
      ivaAdicional = zero(currency)
    }
  }

  const ivaTotal = add(ivaBase, ivaAdicional)
  const total = add(base, ivaTotal)

  return Object.freeze({
    currency,
    alicuota: input.alicuota,
    gross,
    discount,
    base,
    ivaBase,
    ivaAdicional,
    ivaTotal,
    total,
  })
}

// --- Totales de documento ---------------------------------------------------

/** Subtotal por alícuota. Es la fila que pide el libro de ventas. */
export interface AlicuotaSubtotal {
  readonly alicuota: Alicuota
  readonly base: Money
  readonly ivaBase: Money
  readonly ivaAdicional: Money
  readonly total: Money
}

export interface DocumentTotals {
  readonly currency: Currency
  readonly gross: Money
  readonly discount: Money
  readonly base: Money
  readonly exempt: Money
  readonly ivaBase: Money
  readonly ivaAdicional: Money
  readonly ivaTotal: Money
  readonly total: Money
  readonly byAlicuota: readonly AlicuotaSubtotal[]
}

/**
 * Suma las líneas y desglosa por alícuota.
 *
 * El total del documento es la suma de los totales de línea, no un recálculo
 * sobre la base agregada: recalcular introduce un redondeo distinto al que vio
 * el cliente línea por línea y descuadra la factura por céntimos.
 */
export function computeTotals(lines: readonly LineResult[], currency: Currency): DocumentTotals {
  const groups = new Map<string, LineResult[]>()
  for (const line of lines) {
    if (line.currency !== currency) {
      throw new InvalidTaxError(
        `La línea está en ${line.currency} y el documento en ${currency}. Convierta antes de totalizar.`,
      )
    }
    const bucket = groups.get(line.alicuota.codigo)
    if (bucket) bucket.push(line)
    else groups.set(line.alicuota.codigo, [line])
  }

  const byAlicuota: AlicuotaSubtotal[] = []
  for (const bucket of groups.values()) {
    const first = bucket[0]
    /* c8 ignore next -- un grupo del Map nunca está vacío */
    if (!first) continue
    byAlicuota.push(
      Object.freeze({
        alicuota: first.alicuota,
        base: sum(
          currency,
          bucket.map((line) => line.base),
        ),
        ivaBase: sum(
          currency,
          bucket.map((line) => line.ivaBase),
        ),
        ivaAdicional: sum(
          currency,
          bucket.map((line) => line.ivaAdicional),
        ),
        total: sum(
          currency,
          bucket.map((line) => line.total),
        ),
      }),
    )
  }

  const taxable = lines.filter((line) => totalBps(line.alicuota) > 0)
  const exemptLines = lines.filter((line) => totalBps(line.alicuota) === 0)

  const ivaBase = sum(
    currency,
    lines.map((line) => line.ivaBase),
  )
  const ivaAdicional = sum(
    currency,
    lines.map((line) => line.ivaAdicional),
  )

  return Object.freeze({
    currency,
    gross: sum(
      currency,
      lines.map((line) => line.gross),
    ),
    discount: sum(
      currency,
      lines.map((line) => line.discount),
    ),
    base: sum(
      currency,
      taxable.map((line) => line.base),
    ),
    exempt: sum(
      currency,
      exemptLines.map((line) => line.base),
    ),
    ivaBase,
    ivaAdicional,
    ivaTotal: add(ivaBase, ivaAdicional),
    total: sum(
      currency,
      lines.map((line) => line.total),
    ),
    byAlicuota: Object.freeze(byAlicuota),
  })
}

// --- IGTF -------------------------------------------------------------------

/**
 * Alícuota de IGTF por defecto: 3%.
 *
 * Es un parámetro por diseño. La alícuota ha cambiado por decreto más de una vez
 * y depende de si el contribuyente es especial o no; grabarla en el código
 * significaría desplegar una versión nueva cada vez que cambia la gaceta.
 */
export const IGTF_DEFAULT_BPS = 300

/**
 * Calcula el IGTF sobre la porción pagada en divisa.
 *
 * El impuesto grava el PAGO, no la venta: solo entra la parte liquidada en
 * moneda extranjera, y va en línea aparte del IVA.
 */
export function computeIgtf(divisaPayment: Money, basisPoints: number = IGTF_DEFAULT_BPS, mode: RoundingMode = DEFAULT_ROUNDING): Money {
  if (!Number.isInteger(basisPoints) || basisPoints < 0) {
    throw new InvalidTaxError(`Alícuota de IGTF inválida: ${basisPoints} bps.`)
  }
  if (divisaPayment.amount < 0n) {
    throw new InvalidTaxError('La base del IGTF no puede ser negativa.')
  }
  return percentage(divisaPayment, basisPoints, mode)
}

/**
 * Cuánto hay que cobrar en divisa para cubrir un total más su propio IGTF.
 *
 * Sirve para la pregunta del mostrador: "si te pago todo en efectivo dólares,
 * ¿cuánto es?". Cobrar el total y luego el 3% aparte deja la cuenta corta.
 */
export function grossUpIgtf(total: Money, basisPoints: number = IGTF_DEFAULT_BPS, mode: RoundingMode = DEFAULT_ROUNDING): Money {
  if (!Number.isInteger(basisPoints) || basisPoints < 0) {
    throw new InvalidTaxError(`Alícuota de IGTF inválida: ${basisPoints} bps.`)
  }
  return money(total.currency, divideRound(total.amount * BigInt(10000 + basisPoints), 10000n, mode))
}
