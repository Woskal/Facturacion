import type { Currency } from './currency'
import { InvalidPaymentError } from './errors'
import { DEFAULT_ROUNDING, divideRound, type RoundingMode } from './rounding'
import { add, isPositive, money, subtract, sum, zero, type Money } from './money'
import { convert, type Rate } from './rate'
import { IGTF_DEFAULT_BPS } from './tax'

/** Medios de pago del mostrador venezolano. */
export type PaymentMethod =
  | 'EFECTIVO_BS'
  | 'EFECTIVO_USD'
  | 'PAGO_MOVIL'
  | 'TRANSFERENCIA_BS'
  | 'PUNTO_VENTA'
  | 'ZELLE'
  | 'USDT'
  | 'CREDITO'

export interface MethodSpec {
  /** Moneda obligatoria del medio. `null` significa que la elige el operador (crédito). */
  readonly currency: Currency | null
  /** Si activa la percepción de IGTF. */
  readonly divisa: boolean
  /** Si exige número de referencia para poder conciliar después. */
  readonly requiresReference: boolean
  /** Si entrega dinero ahora. El crédito no: va a cuentas por cobrar. */
  readonly settlesNow: boolean
  readonly nombre: string
}

export const METHODS: Readonly<Record<PaymentMethod, MethodSpec>> = Object.freeze({
  EFECTIVO_BS: { currency: 'VES', divisa: false, requiresReference: false, settlesNow: true, nombre: 'Efectivo Bs' },
  EFECTIVO_USD: { currency: 'USD', divisa: true, requiresReference: false, settlesNow: true, nombre: 'Efectivo divisa' },
  PAGO_MOVIL: { currency: 'VES', divisa: false, requiresReference: true, settlesNow: true, nombre: 'Pago móvil' },
  TRANSFERENCIA_BS: { currency: 'VES', divisa: false, requiresReference: true, settlesNow: true, nombre: 'Transferencia Bs' },
  PUNTO_VENTA: { currency: 'VES', divisa: false, requiresReference: true, settlesNow: true, nombre: 'Punto de venta' },
  ZELLE: { currency: 'USD', divisa: true, requiresReference: true, settlesNow: true, nombre: 'Zelle' },
  USDT: { currency: 'USD', divisa: true, requiresReference: true, settlesNow: true, nombre: 'USDT' },
  CREDITO: { currency: null, divisa: false, requiresReference: false, settlesNow: false, nombre: 'Crédito' },
})

export interface PaymentInput {
  readonly method: PaymentMethod
  readonly amount: Money
  readonly reference?: string
}

export interface SettledPayment extends PaymentInput {
  /** El mismo pago expresado en la moneda del documento. */
  readonly inDocumentCurrency: Money
  readonly spec: MethodSpec
}

export interface SettleInput {
  /** Total del documento con IVA, sin IGTF. */
  readonly total: Money
  readonly payments: readonly PaymentInput[]
  readonly rate: Rate
  readonly igtfBps?: number
  /** Moneda en que se entrega el vuelto. Por defecto, la del documento. */
  readonly changeCurrency?: Currency
  readonly rounding?: RoundingMode
}

export interface Settlement {
  readonly currency: Currency
  readonly documentTotal: Money
  /** Porción de la venta efectivamente cubierta con divisa. */
  readonly igtfBase: Money
  readonly igtf: Money
  /** Total a cobrar: documento + IGTF. */
  readonly totalDue: Money
  /** Dinero recibido ahora, en moneda del documento. */
  readonly totalSettled: Money
  /** Monto diferido a cuentas por cobrar. */
  readonly credit: Money
  /** Faltante. Cero si el documento quedó cubierto. */
  readonly balance: Money
  readonly change: Money
  readonly changeCurrency: Currency
  readonly payments: readonly SettledPayment[]
}

/**
 * Valida un pago contra las reglas de su medio.
 *
 * Se valida en el núcleo y no solo en la interfaz porque un pago móvil sin
 * referencia es un pago que no se puede conciliar con el banco después, y para
 * cuando eso se descubre ya pasaron treinta días.
 */
export function validatePayment(payment: PaymentInput): SettledPayment['spec'] {
  const spec = METHODS[payment.method]
  if (!spec) {
    throw new InvalidPaymentError(`Medio de pago desconocido: ${String(payment.method)}`)
  }
  if (payment.amount.amount < 0n) {
    throw new InvalidPaymentError(`El pago por ${spec.nombre} no puede ser negativo.`)
  }
  if (spec.currency !== null && payment.amount.currency !== spec.currency) {
    throw new InvalidPaymentError(
      `${spec.nombre} se registra en ${spec.currency} y se recibió ${payment.amount.currency}.`,
    )
  }
  if (spec.requiresReference && (payment.reference ?? '').trim() === '') {
    throw new InvalidPaymentError(`${spec.nombre} exige número de referencia.`)
  }
  return spec
}

/**
 * Liquida un documento contra una lista de pagos mixtos.
 *
 * Reglas de IGTF: el impuesto grava únicamente la porción de la venta que
 * termina cubierta con divisa. Los pagos en bolívares se imputan primero y la
 * divisa cubre el remanente, de modo que el cliente paga el IGTF mínimo posible
 * — que es lo que hace un cajero razonable y lo que espera el cliente.
 *
 * La divisa entregada incluye su propio IGTF: para cubrir un remanente R hacen
 * falta R × (1 + alícuota) en divisa, no R. Cobrar R y pedir el 3% aparte deja
 * la caja corta todos los días.
 */
export function settle(input: SettleInput): Settlement {
  const rounding = input.rounding ?? DEFAULT_ROUNDING
  const currency = input.total.currency
  const changeCurrency = input.changeCurrency ?? currency
  const igtfBps = input.igtfBps ?? IGTF_DEFAULT_BPS

  if (!Number.isInteger(igtfBps) || igtfBps < 0) {
    throw new InvalidPaymentError(`Alícuota de IGTF inválida: ${igtfBps} bps.`)
  }
  if (input.total.amount < 0n) {
    throw new InvalidPaymentError('El total del documento no puede ser negativo.')
  }

  const settledPayments: SettledPayment[] = input.payments.map((payment) => {
    const spec = validatePayment(payment)
    return Object.freeze({
      ...payment,
      spec,
      inDocumentCurrency: convert(payment.amount, currency, input.rate, rounding),
    })
  })

  const divisaTendered = sum(
    currency,
    settledPayments.filter((p) => p.spec.divisa).map((p) => p.inDocumentCurrency),
  )
  const nonDivisaSettled = sum(
    currency,
    settledPayments.filter((p) => !p.spec.divisa && p.spec.settlesNow).map((p) => p.inDocumentCurrency),
  )
  const credit = sum(
    currency,
    settledPayments.filter((p) => !p.spec.settlesNow).map((p) => p.inDocumentCurrency),
  )

  // Remanente que la divisa debe cubrir, después de imputar bolívares y crédito.
  const coveredWithoutDivisa = add(nonDivisaSettled, credit)
  const remainder = input.total.amount > coveredWithoutDivisa.amount
    ? subtract(input.total, coveredWithoutDivisa)
    : zero(currency)

  // Base gravable = divisa realmente aplicada, descontando su propio IGTF y sin
  // exceder el remanente.
  const divisaAppliedBase = money(
    currency,
    divideRound(divisaTendered.amount * 10000n, BigInt(10000 + igtfBps), rounding),
  )
  const igtfBase = divisaAppliedBase.amount < remainder.amount ? divisaAppliedBase : remainder
  const igtf = money(currency, divideRound(igtfBase.amount * BigInt(igtfBps), 10000n, rounding))

  const totalDue = add(input.total, igtf)
  const totalSettled = add(nonDivisaSettled, divisaTendered)
  const covered = add(totalSettled, credit)

  const excess = subtract(covered, totalDue)

  if (isPositive(excess) && isPositive(credit)) {
    throw new InvalidPaymentError(
      'El monto a crédito excede el saldo pendiente. El crédito no genera vuelto: ajuste el monto diferido.',
    )
  }

  const change = isPositive(excess) ? convert(excess, changeCurrency, input.rate, rounding) : zero(changeCurrency)
  const balance = excess.amount < 0n ? money(currency, -excess.amount) : zero(currency)

  return Object.freeze({
    currency,
    documentTotal: input.total,
    igtfBase,
    igtf,
    totalDue,
    totalSettled,
    credit,
    balance,
    change,
    changeCurrency,
    payments: Object.freeze(settledPayments),
  })
}

/** Si el documento quedó completamente cubierto. */
export function isFullySettled(settlement: Settlement): boolean {
  return settlement.balance.amount === 0n
}
