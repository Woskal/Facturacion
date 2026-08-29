import { describe, expect, it } from 'vitest'
import {
  InvalidPaymentError,
  METHODS,
  grossUpIgtf,
  isFullySettled,
  parseRate,
  settle,
  usd,
  validatePayment,
  ves,
  type PaymentInput,
} from '../src/index'

const HOY = '2026-08-28'
const BCV = parseRate('36,5842', HOY)

/** 100,00 USD son 3.658,42 Bs a la tasa del día. */
const TOTAL = usd(10000n)

function pagar(payments: readonly PaymentInput[], total = TOTAL) {
  return settle({ total, payments, rate: BCV })
}

describe('validación de pagos', () => {
  it('exige la moneda que corresponde al medio', () => {
    expect(() => validatePayment({ method: 'EFECTIVO_USD', amount: ves(100n) })).toThrow(InvalidPaymentError)
    expect(() => validatePayment({ method: 'EFECTIVO_BS', amount: usd(100n) })).toThrow(InvalidPaymentError)
  })

  it('exige referencia donde hace falta conciliar con el banco', () => {
    expect(() => validatePayment({ method: 'PAGO_MOVIL', amount: ves(100n) })).toThrow(InvalidPaymentError)
    expect(() => validatePayment({ method: 'PAGO_MOVIL', amount: ves(100n), reference: '   ' })).toThrow(
      InvalidPaymentError,
    )
    expect(validatePayment({ method: 'PAGO_MOVIL', amount: ves(100n), reference: '004512' })).toBe(METHODS.PAGO_MOVIL)
  })

  it('no exige referencia al efectivo', () => {
    expect(() => validatePayment({ method: 'EFECTIVO_BS', amount: ves(100n) })).not.toThrow()
    expect(() => validatePayment({ method: 'EFECTIVO_USD', amount: usd(100n) })).not.toThrow()
  })

  it('rechaza montos negativos y medios inexistentes', () => {
    expect(() => validatePayment({ method: 'EFECTIVO_BS', amount: ves(-1n) })).toThrow(InvalidPaymentError)
    // @ts-expect-error validación en tiempo de ejecución
    expect(() => validatePayment({ method: 'CRIPTO_LUNA', amount: usd(1n) })).toThrow(InvalidPaymentError)
  })

  it('el crédito acepta cualquier moneda y no liquida', () => {
    expect(METHODS.CREDITO.settlesNow).toBe(false)
    expect(() => validatePayment({ method: 'CREDITO', amount: usd(1n) })).not.toThrow()
    expect(() => validatePayment({ method: 'CREDITO', amount: ves(1n) })).not.toThrow()
  })
})

describe('pago íntegro en bolívares', () => {
  it('no genera IGTF', () => {
    const result = pagar([{ method: 'EFECTIVO_BS', amount: ves(365842n) }])
    expect(result.igtf.amount).toBe(0n)
    expect(result.totalDue.amount).toBe(10000n)
    expect(result.change.amount).toBe(0n)
    expect(isFullySettled(result)).toBe(true)
  })

  it('el pago móvil tampoco lo genera', () => {
    const result = pagar([{ method: 'PAGO_MOVIL', amount: ves(365842n), reference: '004512' }])
    expect(result.igtf.amount).toBe(0n)
    expect(isFullySettled(result)).toBe(true)
  })
})

describe('pago íntegro en divisa', () => {
  it('cobra el 3% sobre la venta y cuadra exacto', () => {
    const aCobrar = grossUpIgtf(TOTAL)
    expect(aCobrar.amount).toBe(10300n)

    const result = pagar([{ method: 'EFECTIVO_USD', amount: aCobrar }])
    expect(result.igtfBase.amount).toBe(10000n)
    expect(result.igtf.amount).toBe(300n)
    expect(result.totalDue.amount).toBe(10300n)
    expect(result.change.amount).toBe(0n)
    expect(result.balance.amount).toBe(0n)
    expect(isFullySettled(result)).toBe(true)
  })

  it('cobrar el total sin el gross-up deja la caja corta', () => {
    const result = pagar([{ method: 'EFECTIVO_USD', amount: TOTAL }])
    expect(result.igtf.amount).toBeGreaterThan(0n)
    expect(isFullySettled(result)).toBe(false)
  })

  it('Zelle y USDT también son divisa', () => {
    for (const method of ['ZELLE', 'USDT'] as const) {
      const result = pagar([{ method, amount: usd(10300n), reference: 'REF-1' }])
      expect(result.igtf.amount).toBe(300n)
      expect(isFullySettled(result)).toBe(true)
    }
  })
})

describe('pago mixto', () => {
  it('imputa primero los bolívares y la divisa cubre el remanente', () => {
    // 50,00 USD en bolívares + el resto en efectivo divisa.
    const enBs = ves(182921n) // 50,00 USD a la tasa
    const result = pagar([
      { method: 'EFECTIVO_BS', amount: enBs },
      { method: 'EFECTIVO_USD', amount: usd(5150n) },
    ])

    // El IGTF grava solo los 50,00 cubiertos con divisa, no los 100,00 de la venta.
    expect(result.igtfBase.amount).toBe(5000n)
    expect(result.igtf.amount).toBe(150n)
    expect(result.totalDue.amount).toBe(10150n)
    expect(result.change.amount).toBe(0n)
    expect(isFullySettled(result)).toBe(true)
  })

  it('el IGTF de un pago mixto es menor que el de pagar todo en divisa', () => {
    const todoDivisa = pagar([{ method: 'EFECTIVO_USD', amount: usd(10300n) }])
    const mixto = pagar([
      { method: 'EFECTIVO_BS', amount: ves(182921n) },
      { method: 'EFECTIVO_USD', amount: usd(5150n) },
    ])
    expect(mixto.igtf.amount).toBeLessThan(todoDivisa.igtf.amount)
  })

  it('acumula varios pagos del mismo medio', () => {
    const result = pagar([
      { method: 'EFECTIVO_BS', amount: ves(182921n) },
      { method: 'EFECTIVO_BS', amount: ves(182921n) },
    ])
    expect(result.totalSettled.amount).toBe(10000n)
    expect(isFullySettled(result)).toBe(true)
  })
})

describe('vuelto', () => {
  it('devuelve el excedente en la moneda del documento', () => {
    const result = pagar([{ method: 'EFECTIVO_USD', amount: usd(20000n) }])
    expect(result.igtfBase.amount).toBe(10000n) // nunca más que la venta
    expect(result.igtf.amount).toBe(300n)
    expect(result.totalDue.amount).toBe(10300n)
    expect(result.change.amount).toBe(9700n)
    expect(result.change.currency).toBe('USD')
  })

  it('puede darse en la otra moneda', () => {
    const result = settle({
      total: TOTAL,
      payments: [{ method: 'EFECTIVO_USD', amount: usd(20000n) }],
      rate: BCV,
      changeCurrency: 'VES',
    })
    expect(result.changeCurrency).toBe('VES')
    // 97,00 USD × 36,5842 = 3.548,67 Bs
    expect(result.change.amount).toBe(354867n)
  })

  it('el IGTF no grava el vuelto', () => {
    const justo = pagar([{ method: 'EFECTIVO_USD', amount: usd(10300n) }])
    const conVuelto = pagar([{ method: 'EFECTIVO_USD', amount: usd(50000n) }])
    expect(conVuelto.igtf.amount).toBe(justo.igtf.amount)
  })
})

describe('pago incompleto', () => {
  it('reporta el saldo pendiente', () => {
    const result = pagar([{ method: 'EFECTIVO_USD', amount: usd(5000n) }])
    expect(isFullySettled(result)).toBe(false)
    expect(result.balance.amount).toBe(5146n)
    expect(result.change.amount).toBe(0n)
  })

  it('un documento sin pagos queda pendiente por completo', () => {
    const result = pagar([])
    expect(result.balance.amount).toBe(10000n)
    expect(result.igtf.amount).toBe(0n)
  })
})

describe('crédito', () => {
  it('difiere el saldo sin dejarlo pendiente', () => {
    const result = pagar([
      { method: 'EFECTIVO_BS', amount: ves(146337n) }, // ~40,00 USD
      { method: 'CREDITO', amount: usd(6000n) },
    ])
    expect(result.credit.amount).toBe(6000n)
    expect(result.igtf.amount).toBe(0n)
    expect(isFullySettled(result)).toBe(true)
    expect(result.totalSettled.amount).toBe(4000n)
  })

  it('no genera vuelto: un crédito de más es un error de captura', () => {
    expect(() =>
      pagar([
        { method: 'EFECTIVO_BS', amount: ves(365842n) },
        { method: 'CREDITO', amount: usd(1000n) },
      ]),
    ).toThrow(InvalidPaymentError)
  })
})

describe('documento en bolívares', () => {
  it('liquida igual con la moneda invertida', () => {
    const totalBs = ves(365842n)
    const result = settle({
      total: totalBs,
      payments: [{ method: 'EFECTIVO_BS', amount: totalBs }],
      rate: BCV,
    })
    expect(result.currency).toBe('VES')
    expect(result.igtf.amount).toBe(0n)
    expect(isFullySettled(result)).toBe(true)
  })

  it('cobra IGTF sobre la divisa aunque el documento esté en bolívares', () => {
    const result = settle({
      total: ves(365842n),
      payments: [{ method: 'EFECTIVO_USD', amount: usd(10300n) }],
      rate: BCV,
    })
    expect(result.igtf.amount).toBeGreaterThan(0n)
    expect(result.currency).toBe('VES')
  })
})

describe('parámetros', () => {
  it('admite otra alícuota de IGTF', () => {
    const sinIgtf = settle({ total: TOTAL, payments: [{ method: 'EFECTIVO_USD', amount: TOTAL }], rate: BCV, igtfBps: 0 })
    expect(sinIgtf.igtf.amount).toBe(0n)
    expect(isFullySettled(sinIgtf)).toBe(true)
  })

  it('rechaza entradas inválidas', () => {
    expect(() => settle({ total: usd(-1n), payments: [], rate: BCV })).toThrow(InvalidPaymentError)
    expect(() => settle({ total: TOTAL, payments: [], rate: BCV, igtfBps: -5 })).toThrow(InvalidPaymentError)
    expect(() => settle({ total: TOTAL, payments: [], rate: BCV, igtfBps: 1.5 })).toThrow(InvalidPaymentError)
  })
})
