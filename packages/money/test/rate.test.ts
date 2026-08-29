import { describe, expect, it } from 'vitest'
import {
  InvalidRateError,
  RATE_SCALE,
  amountIn,
  convert,
  dual,
  parseRate,
  rate,
  rateToDecimalString,
  usd,
  ves,
} from '../src/index'

const HOY = '2026-08-28'
const BCV = parseRate('36,5842', HOY)

describe('construcción de tasa', () => {
  it('parsea el decimal publicado por el BCV', () => {
    expect(BCV.bsPerUsd).toBe(3658420000n)
    expect(BCV.date).toBe(HOY)
    expect(BCV.source).toBe('BCV')
  })

  it('acepta punto o coma', () => {
    expect(parseRate('36.5842', HOY).bsPerUsd).toBe(parseRate('36,5842', HOY).bsPerUsd)
  })

  it('conserva ocho decimales', () => {
    expect(parseRate('36,58421234', HOY).bsPerUsd).toBe(3658421234n)
    expect(rateToDecimalString(BCV)).toBe('36.58420000')
  })

  it('rechaza tasas imposibles', () => {
    expect(() => rate(0n, HOY)).toThrow(InvalidRateError)
    expect(() => rate(-1n, HOY)).toThrow(InvalidRateError)
    // @ts-expect-error validación en tiempo de ejecución
    expect(() => rate(36.58, HOY)).toThrow(InvalidRateError)
    expect(() => rate(RATE_SCALE, '28/08/2026')).toThrow(InvalidRateError)
    expect(() => parseRate('abc', HOY)).toThrow(InvalidRateError)
    expect(() => parseRate('36,123456789', HOY)).toThrow(InvalidRateError)
  })
})

describe('convert', () => {
  it('convierte dólares a bolívares', () => {
    // 100,00 USD × 36,5842 = 3.658,42 Bs
    expect(convert(usd(10000n), 'VES', BCV).amount).toBe(365842n)
  })

  it('convierte bolívares a dólares', () => {
    expect(convert(ves(365842n), 'USD', BCV).amount).toBe(10000n)
  })

  it('no toca el monto si la moneda ya es la de destino', () => {
    const value = usd(12345n)
    expect(convert(value, 'USD', BCV)).toBe(value)
  })

  it('respeta el modo de redondeo', () => {
    // 1 céntimo de dólar = 0,365842 Bs → 0,37 con HALF_UP, 0,36 truncando.
    expect(convert(usd(1n), 'VES', BCV).amount).toBe(37n)
    expect(convert(usd(1n), 'VES', BCV, 'TRUNCATE').amount).toBe(36n)
  })

  it('el redondeo de ida y vuelta nunca se aleja más de un céntimo', () => {
    for (let cents = 1n; cents <= 500n; cents += 7n) {
      const original = usd(cents)
      const roundTrip = convert(convert(original, 'VES', BCV), 'USD', BCV)
      const drift = roundTrip.amount - original.amount
      expect(drift >= -1n && drift <= 1n).toBe(true)
    }
  })
})

describe('dual', () => {
  it('guarda las dos monedas junto a la tasa usada', () => {
    const pair = dual(usd(10000n), BCV)
    expect(pair.usd.amount).toBe(10000n)
    expect(pair.ves.amount).toBe(365842n)
    expect(pair.rate).toBe(BCV)
  })

  it('produce el mismo par partiendo de cualquiera de las dos monedas', () => {
    const fromUsd = dual(usd(10000n), BCV)
    const fromVes = dual(ves(365842n), BCV)
    expect(fromVes.usd).toEqual(fromUsd.usd)
    expect(fromVes.ves).toEqual(fromUsd.ves)
  })

  it('un histórico se reconstruye con su propia tasa, no con la de hoy', () => {
    const tasaVieja = parseRate('20,0000', '2025-01-15')
    const tasaHoy = parseRate('36,5842', HOY)
    const venta = dual(usd(10000n), tasaVieja)

    expect(venta.ves.amount).toBe(200000n) // Bs 2.000,00 el día de la venta
    expect(convert(usd(10000n), 'VES', tasaHoy).amount).toBe(365842n) // lo de hoy es otra cosa
    expect(venta.rate.date).toBe('2025-01-15')
  })

  it('amountIn selecciona la moneda pedida', () => {
    const pair = dual(usd(10000n), BCV)
    expect(amountIn(pair, 'USD')).toEqual(pair.usd)
    expect(amountIn(pair, 'VES')).toEqual(pair.ves)
  })
})
