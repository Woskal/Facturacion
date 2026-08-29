import { describe, expect, it } from 'vitest'
import {
  ALICUOTAS,
  IGTF_DEFAULT_BPS,
  InvalidTaxError,
  alicuota,
  computeIgtf,
  computeLine,
  computeTotals,
  grossUpIgtf,
  totalBps,
  usd,
  ves,
  type LineInput,
} from '../src/index'

const UNA_UNIDAD = 1000n

function linea(overrides: Partial<LineInput> = {}): LineInput {
  return {
    quantity: UNA_UNIDAD,
    unitPrice: usd(10000n),
    alicuota: ALICUOTAS.GENERAL,
    priceMode: 'IVA_EXCLUIDO',
    ...overrides,
  }
}

describe('alícuotas', () => {
  it('modela la suntuaria como 16% + 15% adicional, no como 31%', () => {
    expect(ALICUOTAS.SUNTUARIA.baseBps).toBe(1600)
    expect(ALICUOTAS.SUNTUARIA.adicionalBps).toBe(1500)
    expect(totalBps(ALICUOTAS.SUNTUARIA)).toBe(3100)
  })

  it('expone las alícuotas vigentes', () => {
    expect(totalBps(ALICUOTAS.GENERAL)).toBe(1600)
    expect(totalBps(ALICUOTAS.REDUCIDA)).toBe(800)
    expect(totalBps(ALICUOTAS.EXENTO)).toBe(0)
  })

  it('permite definir alícuotas propias, porque cambian por decreto', () => {
    expect(totalBps(alicuota('X', 'Hipotética 12%', 1200))).toBe(1200)
    expect(() => alicuota('X', 'mal', -100)).toThrow(InvalidTaxError)
    expect(() => alicuota('X', 'mal', 1600, -1)).toThrow(InvalidTaxError)
    expect(() => alicuota('X', 'mal', 16.5)).toThrow(InvalidTaxError)
  })
})

describe('computeLine con IVA excluido', () => {
  it('agrega el IVA sobre la base', () => {
    const result = computeLine(linea())
    expect(result.base.amount).toBe(10000n)
    expect(result.ivaBase.amount).toBe(1600n)
    expect(result.ivaAdicional.amount).toBe(0n)
    expect(result.total.amount).toBe(11600n)
  })

  it('desglosa la alícuota adicional del suntuario', () => {
    const result = computeLine(linea({ alicuota: ALICUOTAS.SUNTUARIA }))
    expect(result.base.amount).toBe(10000n)
    expect(result.ivaBase.amount).toBe(1600n)
    expect(result.ivaAdicional.amount).toBe(1500n)
    expect(result.ivaTotal.amount).toBe(3100n)
    expect(result.total.amount).toBe(13100n)
  })

  it('no cobra IVA sobre lo exento', () => {
    const result = computeLine(linea({ alicuota: ALICUOTAS.EXENTO }))
    expect(result.ivaTotal.amount).toBe(0n)
    expect(result.total.amount).toBe(10000n)
  })
})

describe('computeLine con IVA incluido', () => {
  it('despeja la base hacia atrás', () => {
    const result = computeLine(linea({ unitPrice: usd(11600n), priceMode: 'IVA_INCLUIDO' }))
    expect(result.base.amount).toBe(10000n)
    expect(result.ivaBase.amount).toBe(1600n)
    expect(result.total.amount).toBe(11600n)
  })

  it('el total es exactamente el precio que vio el cliente', () => {
    // Precios "feos" a propósito: aquí es donde un despeje mal hecho suma un céntimo.
    for (const precio of [199n, 999n, 1n, 33333n, 12345n, 7n]) {
      const result = computeLine(linea({ unitPrice: usd(precio), priceMode: 'IVA_INCLUIDO' }))
      expect(result.total.amount).toBe(precio)
      expect(result.base.amount + result.ivaTotal.amount).toBe(precio)
    }
  })

  it('reparte el IVA embebido entre alícuota principal y adicional sin perder céntimos', () => {
    const result = computeLine(linea({ unitPrice: usd(13100n), alicuota: ALICUOTAS.SUNTUARIA, priceMode: 'IVA_INCLUIDO' }))
    expect(result.base.amount).toBe(10000n)
    expect(result.ivaBase.amount).toBe(1600n)
    expect(result.ivaAdicional.amount).toBe(1500n)
    expect(result.ivaBase.amount + result.ivaAdicional.amount).toBe(result.ivaTotal.amount)
    expect(result.total.amount).toBe(13100n)
  })

  it('trata lo exento como base pura', () => {
    const result = computeLine(linea({ unitPrice: usd(10000n), alicuota: ALICUOTAS.EXENTO, priceMode: 'IVA_INCLUIDO' }))
    expect(result.base.amount).toBe(10000n)
    expect(result.ivaTotal.amount).toBe(0n)
  })
})

describe('cantidades y descuentos', () => {
  it('admite cantidades fraccionarias', () => {
    // 1,5 unidades de 9,99
    const result = computeLine(linea({ quantity: 1500n, unitPrice: usd(999n) }))
    expect(result.gross.amount).toBe(1499n) // 14,985 → 14,99
  })

  it('pesa en milésimas', () => {
    // 0,750 kg a 12,00 el kilo
    const result = computeLine(linea({ quantity: 750n, unitPrice: usd(1200n) }))
    expect(result.gross.amount).toBe(900n)
  })

  it('aplica el descuento antes del IVA', () => {
    const result = computeLine(linea({ discountBps: 500 }))
    expect(result.discount.amount).toBe(500n)
    expect(result.base.amount).toBe(9500n)
    expect(result.ivaBase.amount).toBe(1520n)
    expect(result.total.amount).toBe(11020n)
  })

  it('admite descuento del 100%', () => {
    const result = computeLine(linea({ discountBps: 10000 }))
    expect(result.base.amount).toBe(0n)
    expect(result.total.amount).toBe(0n)
  })

  it('rechaza entradas inválidas', () => {
    expect(() => computeLine(linea({ quantity: -1n }))).toThrow(InvalidTaxError)
    expect(() => computeLine(linea({ discountBps: -1 }))).toThrow(InvalidTaxError)
    expect(() => computeLine(linea({ discountBps: 10001 }))).toThrow(InvalidTaxError)
    expect(() => computeLine(linea({ discountBps: 5.5 }))).toThrow(InvalidTaxError)
  })
})

describe('computeTotals', () => {
  it('suma los totales de línea en vez de recalcular sobre la base agregada', () => {
    const lines = [
      computeLine(linea({ unitPrice: usd(333n) })),
      computeLine(linea({ unitPrice: usd(333n) })),
      computeLine(linea({ unitPrice: usd(333n) })),
    ]
    const totals = computeTotals(lines, 'USD')
    // Cada línea redondea 53,28 → 53. El documento suma 159, no los 160 que
    // daría recalcular el 16% sobre 999.
    expect(totals.ivaTotal.amount).toBe(159n)
    expect(totals.total.amount).toBe(1158n)
  })

  it('desglosa por alícuota como lo pide el libro de ventas', () => {
    const lines = [
      computeLine(linea({ unitPrice: usd(10000n) })),
      computeLine(linea({ unitPrice: usd(5000n), alicuota: ALICUOTAS.REDUCIDA })),
      computeLine(linea({ unitPrice: usd(2000n), alicuota: ALICUOTAS.EXENTO })),
      computeLine(linea({ unitPrice: usd(1000n), alicuota: ALICUOTAS.SUNTUARIA })),
    ]
    const totals = computeTotals(lines, 'USD')

    expect(totals.byAlicuota).toHaveLength(4)
    const general = totals.byAlicuota.find((row) => row.alicuota.codigo === 'G')
    const reducida = totals.byAlicuota.find((row) => row.alicuota.codigo === 'R')
    const suntuaria = totals.byAlicuota.find((row) => row.alicuota.codigo === 'S')

    expect(general?.ivaBase.amount).toBe(1600n)
    expect(reducida?.ivaBase.amount).toBe(400n)
    expect(suntuaria?.ivaBase.amount).toBe(160n)
    expect(suntuaria?.ivaAdicional.amount).toBe(150n)

    // La base gravable excluye lo exento; lo exento va en su propia casilla.
    expect(totals.base.amount).toBe(16000n)
    expect(totals.exempt.amount).toBe(2000n)
    expect(totals.ivaTotal.amount).toBe(2310n)
    expect(totals.total.amount).toBe(20310n)
  })

  it('agrupa varias líneas de la misma alícuota', () => {
    const lines = [computeLine(linea()), computeLine(linea())]
    const totals = computeTotals(lines, 'USD')
    expect(totals.byAlicuota).toHaveLength(1)
    expect(totals.byAlicuota[0]?.base.amount).toBe(20000n)
  })

  it('acepta un documento vacío', () => {
    const totals = computeTotals([], 'VES')
    expect(totals.total.amount).toBe(0n)
    expect(totals.byAlicuota).toHaveLength(0)
  })

  it('impide mezclar monedas dentro de un documento', () => {
    const line = computeLine(linea({ unitPrice: ves(10000n) }))
    expect(() => computeTotals([line], 'USD')).toThrow(InvalidTaxError)
  })
})

describe('IGTF', () => {
  it('aplica 3% por defecto', () => {
    expect(IGTF_DEFAULT_BPS).toBe(300)
    expect(computeIgtf(usd(10000n)).amount).toBe(300n)
  })

  it('admite otra alícuota, porque cambia por decreto', () => {
    expect(computeIgtf(usd(10000n), 0).amount).toBe(0n)
    expect(computeIgtf(usd(10000n), 200).amount).toBe(200n)
  })

  it('grossUp devuelve cuánto cobrar en divisa para cubrir total más IGTF', () => {
    expect(grossUpIgtf(usd(10000n)).amount).toBe(10300n)
    expect(grossUpIgtf(usd(999n)).amount).toBe(1029n) // 1028,97 → 1029
  })

  it('rechaza parámetros inválidos', () => {
    expect(() => computeIgtf(usd(100n), -1)).toThrow(InvalidTaxError)
    expect(() => computeIgtf(usd(100n), 1.5)).toThrow(InvalidTaxError)
    expect(() => computeIgtf(usd(-100n))).toThrow(InvalidTaxError)
    expect(() => grossUpIgtf(usd(100n), -1)).toThrow(InvalidTaxError)
  })
})
