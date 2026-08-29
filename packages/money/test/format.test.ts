import { describe, expect, it } from 'vitest'
import { formatDual, formatMoney, formatRate, parseMoney, parseRate, usd, ves } from '../src/index'

describe('formatMoney', () => {
  it('usa la convención venezolana: punto para miles, coma para decimales', () => {
    expect(formatMoney(ves(123456n))).toBe('Bs 1.234,56')
    expect(formatMoney(usd(123456n))).toBe('$1.234,56')
  })

  it('agrupa cifras largas', () => {
    expect(formatMoney(ves(100000000n))).toBe('Bs 1.000.000,00')
    expect(formatMoney(ves(999n))).toBe('Bs 9,99')
    expect(formatMoney(ves(0n))).toBe('Bs 0,00')
    expect(formatMoney(ves(5n))).toBe('Bs 0,05')
  })

  it('pone el signo delante del símbolo', () => {
    expect(formatMoney(usd(-150n))).toBe('-$1,50')
    expect(formatMoney(ves(-123456n))).toBe('-Bs 1.234,56')
  })

  it('puede omitir el símbolo', () => {
    expect(formatMoney(usd(123456n), { symbol: false })).toBe('1.234,56')
  })

  it('admite otros separadores', () => {
    expect(formatMoney(usd(123456n), { groupSeparator: ',', decimalSeparator: '.' })).toBe('$1,234.56')
  })

  it('no pasa por float ni con montos enormes', () => {
    // Más allá de Number.MAX_SAFE_INTEGER: un float perdería dígitos aquí.
    expect(formatMoney(ves(9007199254740993n), { symbol: false })).toBe('90.071.992.547.409,93')
  })

  it('cierra el ciclo con parseMoney', () => {
    for (const amount of [0n, 5n, 999n, 123456n, -123456n, 100000000n]) {
      const value = ves(amount)
      expect(parseMoney(formatMoney(value, { symbol: false }), 'VES')).toEqual(value)
    }
  })
})

describe('formatRate', () => {
  it('recorta los ceros de relleno', () => {
    expect(formatRate(parseRate('36,5842', '2026-08-28'))).toBe('36,5842')
    expect(formatRate(parseRate('36', '2026-08-28'))).toBe('36')
    expect(formatRate(parseRate('1234,5', '2026-08-28'))).toBe('1.234,5')
  })
})

describe('formatDual', () => {
  it('imprime el par como va en el documento', () => {
    expect(formatDual(ves(365842n), usd(10000n))).toBe('Bs 3.658,42 · $100,00')
  })
})
