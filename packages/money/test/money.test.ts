import { describe, expect, it } from 'vitest'
import {
  CurrencyMismatchError,
  InvalidAmountError,
  add,
  allocate,
  compare,
  equals,
  fromJSON,
  isNegative,
  isPositive,
  isZero,
  max,
  min,
  money,
  multiply,
  multiplyRatio,
  negate,
  absolute,
  parseMoney,
  percentage,
  split,
  subtract,
  sum,
  toDecimalString,
  toJSON,
  usd,
  ves,
  zero,
} from '../src/index'

describe('construcción', () => {
  it('crea montos en unidades menores', () => {
    expect(usd(12345n).amount).toBe(12345n)
    expect(usd(12345n).currency).toBe('USD')
    expect(ves(1n).currency).toBe('VES')
    expect(zero('USD').amount).toBe(0n)
  })

  it('rechaza montos que no sean bigint', () => {
    // @ts-expect-error validación en tiempo de ejecución
    expect(() => money('USD', 100)).toThrow(InvalidAmountError)
  })

  it('rechaza monedas desconocidas', () => {
    // @ts-expect-error validación en tiempo de ejecución
    expect(() => money('EUR', 100n)).toThrow(InvalidAmountError)
  })

  it('devuelve objetos inmutables', () => {
    expect(Object.isFrozen(usd(1n))).toBe(true)
  })
})

describe('parseMoney', () => {
  it('acepta coma como separador decimal', () => {
    expect(parseMoney('1234,56', 'VES').amount).toBe(123456n)
  })

  it('acepta punto como separador decimal', () => {
    expect(parseMoney('1234.56', 'USD').amount).toBe(123456n)
  })

  it('acepta separadores de miles', () => {
    expect(parseMoney('1.234,56', 'VES').amount).toBe(123456n)
    expect(parseMoney('1,234.56', 'USD').amount).toBe(123456n)
    expect(parseMoney('1 234 567,89', 'VES').amount).toBe(123456789n)
  })

  it('completa los decimales faltantes', () => {
    expect(parseMoney('10', 'USD').amount).toBe(1000n)
    expect(parseMoney('10,5', 'USD').amount).toBe(1050n)
    expect(parseMoney(',05', 'USD').amount).toBe(5n)
  })

  it('maneja el signo', () => {
    expect(parseMoney('-1,50', 'USD').amount).toBe(-150n)
    expect(parseMoney('+1,50', 'USD').amount).toBe(150n)
  })

  it('lee un separador con tres dígitos detrás como agrupación de miles', () => {
    // "1.234" en Venezuela es mil doscientos treinta y cuatro, no 1,234.
    expect(parseMoney('1.234', 'VES').amount).toBe(123400n)
    expect(parseMoney('1,234', 'USD').amount).toBe(123400n)
  })

  it('rechaza agrupaciones inválidas en vez de adivinar', () => {
    expect(() => parseMoney('12,34,56', 'USD')).toThrow(InvalidAmountError)
    expect(() => parseMoney('1,2345', 'USD')).toThrow(InvalidAmountError)
    expect(() => parseMoney('0,001', 'VES')).toThrow(InvalidAmountError)
    expect(() => parseMoney('1.234,567', 'VES')).toThrow(InvalidAmountError)
    expect(() => parseMoney('1.234,56.78', 'VES')).toThrow(InvalidAmountError)
  })

  it('rechaza entradas que no son montos', () => {
    expect(() => parseMoney('', 'USD')).toThrow(InvalidAmountError)
    expect(() => parseMoney('   ', 'USD')).toThrow(InvalidAmountError)
    expect(() => parseMoney('abc', 'USD')).toThrow(InvalidAmountError)
    expect(() => parseMoney('-', 'USD')).toThrow(InvalidAmountError)
    expect(() => parseMoney('1,', 'USD')).toThrow(InvalidAmountError)
    expect(() => parseMoney(',', 'USD')).toThrow(InvalidAmountError)
  })
})

describe('toDecimalString', () => {
  it('imprime el decimal exacto', () => {
    expect(toDecimalString(usd(123456n))).toBe('1234.56')
    expect(toDecimalString(usd(5n))).toBe('0.05')
    expect(toDecimalString(usd(-150n))).toBe('-1.50')
    expect(toDecimalString(ves(0n))).toBe('0.00')
  })

  it('cierra el ciclo con parseMoney', () => {
    for (const amount of [0n, 1n, 99n, 100n, -12345n, 987654321n]) {
      const value = usd(amount)
      expect(parseMoney(toDecimalString(value), 'USD')).toEqual(value)
    }
  })
})

describe('aritmética', () => {
  it('suma y resta', () => {
    expect(add(usd(100n), usd(50n)).amount).toBe(150n)
    expect(subtract(usd(100n), usd(150n)).amount).toBe(-50n)
    expect(sum('USD', [usd(1n), usd(2n), usd(3n)]).amount).toBe(6n)
    expect(sum('VES', []).amount).toBe(0n)
  })

  it('impide mezclar monedas sin convertir', () => {
    expect(() => add(usd(100n), ves(100n))).toThrow(CurrencyMismatchError)
    expect(() => subtract(usd(100n), ves(100n))).toThrow(CurrencyMismatchError)
    expect(() => compare(usd(100n), ves(100n))).toThrow(CurrencyMismatchError)
  })

  it('niega y toma valor absoluto', () => {
    expect(negate(usd(100n)).amount).toBe(-100n)
    expect(absolute(usd(-100n)).amount).toBe(100n)
  })

  it('multiplica por enteros', () => {
    expect(multiply(usd(333n), 3n).amount).toBe(999n)
  })

  it('multiplica por razones con redondeo explícito', () => {
    expect(multiplyRatio(usd(100n), 1n, 3n).amount).toBe(33n)
    expect(multiplyRatio(usd(100n), 2n, 3n).amount).toBe(67n)
    expect(multiplyRatio(usd(100n), 2n, 3n, 'TRUNCATE').amount).toBe(66n)
  })

  it('aplica porcentajes en puntos básicos', () => {
    expect(percentage(usd(10000n), 1600).amount).toBe(1600n)
    expect(percentage(usd(333n), 1600).amount).toBe(53n) // 53,28 → 53
    expect(percentage(usd(100n), 0).amount).toBe(0n)
    expect(percentage(usd(10000n), 300).amount).toBe(300n)
  })

  it('rechaza puntos básicos fraccionarios', () => {
    expect(() => percentage(usd(100n), 16.5)).toThrow(InvalidAmountError)
  })
})

describe('comparación', () => {
  it('ordena', () => {
    expect(compare(usd(1n), usd(2n))).toBe(-1)
    expect(compare(usd(2n), usd(1n))).toBe(1)
    expect(compare(usd(1n), usd(1n))).toBe(0)
    expect(max(usd(1n), usd(2n)).amount).toBe(2n)
    expect(min(usd(1n), usd(2n)).amount).toBe(1n)
  })

  it('compara igualdad incluyendo la moneda', () => {
    expect(equals(usd(100n), usd(100n))).toBe(true)
    expect(equals(usd(100n), ves(100n))).toBe(false)
  })

  it('clasifica el signo', () => {
    expect(isZero(usd(0n))).toBe(true)
    expect(isPositive(usd(1n))).toBe(true)
    expect(isNegative(usd(-1n))).toBe(true)
    expect(isPositive(usd(0n))).toBe(false)
    expect(isNegative(usd(0n))).toBe(false)
  })
})

describe('allocate', () => {
  it('reparte sin perder céntimos', () => {
    const parts = allocate(usd(100n), [1n, 1n, 1n])
    expect(parts.map((p) => p.amount)).toEqual([34n, 33n, 33n])
    expect(sum('USD', parts).amount).toBe(100n)
  })

  it('reparte en proporción a los pesos', () => {
    const parts = allocate(usd(10000n), [7000n, 3000n])
    expect(parts.map((p) => p.amount)).toEqual([7000n, 3000n])
  })

  it('reparte montos negativos conservando el signo', () => {
    const parts = allocate(usd(-100n), [1n, 1n, 1n])
    expect(parts.map((p) => p.amount)).toEqual([-34n, -33n, -33n])
    expect(sum('USD', parts).amount).toBe(-100n)
  })

  it('reparte en partes iguales cuando los pesos suman cero', () => {
    const parts = allocate(usd(1000n), [0n, 0n])
    expect(parts.map((p) => p.amount)).toEqual([500n, 500n])
  })

  it('es determinista ante empates: el sobrante va a los primeros índices', () => {
    expect(allocate(usd(5n), [1n, 1n, 1n]).map((p) => p.amount)).toEqual([2n, 2n, 1n])
  })

  it('rechaza entradas imposibles', () => {
    expect(() => allocate(usd(100n), [])).toThrow(InvalidAmountError)
    expect(() => allocate(usd(100n), [1n, -1n])).toThrow(InvalidAmountError)
  })

  it('split divide en partes casi iguales y exactas', () => {
    expect(split(usd(10n), 4).map((p) => p.amount)).toEqual([3n, 3n, 2n, 2n])
    expect(sum('USD', split(usd(10n), 4)).amount).toBe(10n)
    expect(() => split(usd(10n), 0)).toThrow(InvalidAmountError)
    expect(() => split(usd(10n), 1.5)).toThrow(InvalidAmountError)
  })
})

describe('serialización', () => {
  it('cierra el ciclo pasando por JSON', () => {
    const value = usd(-987654321n)
    const restored = fromJSON(JSON.parse(JSON.stringify(toJSON(value))))
    expect(restored).toEqual(value)
  })

  it('serializa el monto como texto porque JSON no tiene bigint', () => {
    expect(toJSON(ves(100n))).toEqual({ currency: 'VES', amount: '100' })
  })

  it('rechaza montos serializados corruptos', () => {
    expect(() => fromJSON({ currency: 'USD', amount: '1.5' })).toThrow(InvalidAmountError)
    // @ts-expect-error validación en tiempo de ejecución
    expect(() => fromJSON({ currency: 'BTC', amount: '1' })).toThrow(InvalidAmountError)
  })
})
