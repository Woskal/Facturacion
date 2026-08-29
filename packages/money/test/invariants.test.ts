import { describe, expect, it } from 'vitest'
import {
  ALICUOTAS,
  allocate,
  computeLine,
  computeTotals,
  isFullySettled,
  parseRate,
  settle,
  subtract,
  sum,
  usd,
  ves,
  type Alicuota,
  type PriceMode,
} from '../src/index'

/**
 * Generador determinista. No se usa `Math.random` a propósito: un test que falla
 * una vez de cada mil y no se puede reproducir es peor que no tener el test.
 */
function prng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const CASOS = 400
const ALICUOTAS_LISTA: Alicuota[] = [ALICUOTAS.GENERAL, ALICUOTAS.REDUCIDA, ALICUOTAS.SUNTUARIA, ALICUOTAS.EXENTO]
const MODOS: PriceMode[] = ['IVA_INCLUIDO', 'IVA_EXCLUIDO']

describe('invariante: allocate nunca pierde ni inventa un céntimo', () => {
  it('se cumple para montos y pesos arbitrarios', () => {
    const random = prng(1)
    for (let i = 0; i < CASOS; i += 1) {
      const amount = BigInt(Math.floor(random() * 10_000_000)) * (random() < 0.15 ? -1n : 1n)
      const count = 1 + Math.floor(random() * 8)
      const weights = Array.from({ length: count }, () => BigInt(Math.floor(random() * 1000)))

      const parts = allocate(usd(amount), weights)

      expect(parts).toHaveLength(count)
      expect(sum('USD', parts).amount).toBe(amount)
      // Ninguna partida cambia de signo respecto al total.
      for (const part of parts) {
        expect(amount >= 0n ? part.amount >= 0n : part.amount <= 0n).toBe(true)
      }
    }
  })
})

describe('invariante: con IVA incluido, el cliente paga el precio de la etiqueta', () => {
  it('el total de la línea es exactamente precio × cantidad, sin descuento', () => {
    const random = prng(2)
    for (let i = 0; i < CASOS; i += 1) {
      const price = BigInt(1 + Math.floor(random() * 500_000))
      const alicuota = ALICUOTAS_LISTA[Math.floor(random() * ALICUOTAS_LISTA.length)] ?? ALICUOTAS.GENERAL

      const line = computeLine({
        quantity: 1000n,
        unitPrice: usd(price),
        alicuota,
        priceMode: 'IVA_INCLUIDO',
      })

      expect(line.total.amount).toBe(price)
      expect(line.base.amount + line.ivaTotal.amount).toBe(price)
      expect(line.ivaBase.amount + line.ivaAdicional.amount).toBe(line.ivaTotal.amount)
    }
  })
})

describe('invariante: el total del documento es la suma de sus líneas', () => {
  it('se cumple mezclando alícuotas, modos, cantidades y descuentos', () => {
    const random = prng(3)
    for (let i = 0; i < 120; i += 1) {
      const lines = Array.from({ length: 1 + Math.floor(random() * 10) }, () =>
        computeLine({
          quantity: BigInt(1 + Math.floor(random() * 5000)),
          unitPrice: usd(BigInt(1 + Math.floor(random() * 100_000))),
          alicuota: ALICUOTAS_LISTA[Math.floor(random() * ALICUOTAS_LISTA.length)] ?? ALICUOTAS.GENERAL,
          priceMode: MODOS[Math.floor(random() * MODOS.length)] ?? 'IVA_EXCLUIDO',
          discountBps: Math.floor(random() * 3000),
        }),
      )

      const totals = computeTotals(lines, 'USD')

      expect(totals.total.amount).toBe(lines.reduce((acc, line) => acc + line.total.amount, 0n))
      expect(totals.ivaTotal.amount).toBe(totals.ivaBase.amount + totals.ivaAdicional.amount)
      // Base gravable + exento + IVA = total del documento.
      expect(totals.base.amount + totals.exempt.amount + totals.ivaTotal.amount).toBe(totals.total.amount)
      // El desglose por alícuota cubre el documento completo.
      expect(sum('USD', totals.byAlicuota.map((row) => row.total)).amount).toBe(totals.total.amount)
    }
  })
})

describe('invariante: la caja cuadra', () => {
  it('lo recibido menos el vuelto es exactamente lo debido', () => {
    const random = prng(4)
    const rate = parseRate('36,5842', '2026-08-28')

    for (let i = 0; i < CASOS; i += 1) {
      const total = usd(BigInt(1 + Math.floor(random() * 200_000)))
      const enBs = BigInt(Math.floor(random() * 500_000))
      const enUsd = BigInt(Math.floor(random() * 200_000))

      const result = settle({
        total,
        rate,
        payments: [
          { method: 'EFECTIVO_BS', amount: ves(enBs) },
          { method: 'EFECTIVO_USD', amount: usd(enUsd) },
        ],
      })

      // El vuelto se entrega en la moneda del documento, así que no hay pérdida
      // por conversión y la identidad debe darse al céntimo.
      const recibido = result.totalSettled
      const debido = result.totalDue

      if (isFullySettled(result)) {
        expect(subtract(recibido, result.change).amount).toBe(debido.amount)
        expect(result.balance.amount).toBe(0n)
      } else {
        expect(result.change.amount).toBe(0n)
        expect(recibido.amount + result.balance.amount).toBe(debido.amount)
      }

      // El IGTF nunca grava más que la propia venta.
      expect(result.igtfBase.amount).toBeLessThanOrEqual(total.amount)
      expect(result.igtfBase.amount).toBeGreaterThanOrEqual(0n)
    }
  })

  it('pagar en bolívares nunca genera IGTF', () => {
    const random = prng(5)
    const rate = parseRate('36,5842', '2026-08-28')

    for (let i = 0; i < CASOS; i += 1) {
      const result = settle({
        total: usd(BigInt(1 + Math.floor(random() * 200_000))),
        rate,
        payments: [{ method: 'EFECTIVO_BS', amount: ves(BigInt(Math.floor(random() * 10_000_000))) }],
      })
      expect(result.igtf.amount).toBe(0n)
    }
  })
})
