import { describe, expect, it } from 'vitest'
import { MoneyError, abs, divideRound, pow10 } from '../src/index'

describe('divideRound', () => {
  it('devuelve el cociente exacto cuando no hay resto', () => {
    expect(divideRound(10n, 2n)).toBe(5n)
    expect(divideRound(-10n, 2n)).toBe(-5n)
    expect(divideRound(10n, -2n)).toBe(-5n)
    expect(divideRound(-10n, -2n)).toBe(5n)
    expect(divideRound(0n, 7n)).toBe(0n)
  })

  it('HALF_UP aleja el medio del cero', () => {
    expect(divideRound(5n, 2n, 'HALF_UP')).toBe(3n)
    expect(divideRound(-5n, 2n, 'HALF_UP')).toBe(-3n)
    expect(divideRound(7n, 2n, 'HALF_UP')).toBe(4n)
    expect(divideRound(4n, 3n, 'HALF_UP')).toBe(1n)
    expect(divideRound(5n, 3n, 'HALF_UP')).toBe(2n)
  })

  it('es el modo predeterminado', () => {
    expect(divideRound(5n, 2n)).toBe(divideRound(5n, 2n, 'HALF_UP'))
  })

  it('HALF_EVEN lleva el empate al par', () => {
    expect(divideRound(5n, 2n, 'HALF_EVEN')).toBe(2n)
    expect(divideRound(7n, 2n, 'HALF_EVEN')).toBe(4n)
    expect(divideRound(-5n, 2n, 'HALF_EVEN')).toBe(-2n)
    // Sin empate se comporta como el redondeo normal.
    expect(divideRound(8n, 3n, 'HALF_EVEN')).toBe(3n)
    expect(divideRound(7n, 3n, 'HALF_EVEN')).toBe(2n)
  })

  it('TRUNCATE va hacia cero y AWAY se aleja', () => {
    expect(divideRound(9n, 2n, 'TRUNCATE')).toBe(4n)
    expect(divideRound(-9n, 2n, 'TRUNCATE')).toBe(-4n)
    expect(divideRound(1n, 2n, 'AWAY')).toBe(1n)
    expect(divideRound(-1n, 2n, 'AWAY')).toBe(-1n)
    expect(divideRound(1n, 1000n, 'TRUNCATE')).toBe(0n)
  })

  it('el redondeo es simétrico respecto al cero', () => {
    for (const mode of ['HALF_UP', 'HALF_EVEN', 'TRUNCATE', 'AWAY'] as const) {
      for (let n = -20n; n <= 20n; n += 1n) {
        expect(divideRound(-n, 7n, mode)).toBe(-divideRound(n, 7n, mode))
      }
    }
  })

  it('rechaza la división por cero', () => {
    expect(() => divideRound(1n, 0n)).toThrow(MoneyError)
  })

  it('opera sin pérdida con magnitudes enormes', () => {
    // Un monto que desbordaría la precisión de un float de 64 bits.
    const huge = 12345678901234567890123n
    expect(divideRound(huge * 3n, 3n)).toBe(huge)
  })
})

describe('pow10 y abs', () => {
  it('calcula potencias de diez', () => {
    expect(pow10(0)).toBe(1n)
    expect(pow10(2)).toBe(100n)
    expect(pow10(8)).toBe(100000000n)
  })

  it('rechaza exponentes inválidos', () => {
    expect(() => pow10(-1)).toThrow(MoneyError)
    expect(() => pow10(1.5)).toThrow(MoneyError)
  })

  it('devuelve la magnitud', () => {
    expect(abs(-5n)).toBe(5n)
    expect(abs(5n)).toBe(5n)
    expect(abs(0n)).toBe(0n)
  })
})
