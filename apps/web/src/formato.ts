import { convert, formatMoney, formatRate, money, type Money, type Rate } from '@fve/money'

/**
 * Presentación de importes.
 *
 * El negocio ancla sus precios al dólar y cobra en bolívares, así que en
 * pantalla manda el bolívar y el dólar va de apoyo. El cajero no debería tener
 * que convertir de cabeza nunca.
 */
export function bs(value: Money, rate: Rate): string {
  return formatMoney(convert(value, 'VES', rate))
}

export function usd(value: Money, rate: Rate): string {
  return formatMoney(convert(value, 'USD', rate))
}

export function tasa(rate: Rate): string {
  return formatRate(rate)
}

/** Cantidad en milésimas → texto legible, sin ceros de relleno. */
export function cantidad(milesimas: bigint): string {
  const negativo = milesimas < 0n
  const magnitud = negativo ? -milesimas : milesimas
  const entero = magnitud / 1000n
  const resto = (magnitud % 1000n).toString().padStart(3, '0').replace(/0+$/, '')
  const texto = resto === '' ? `${entero}` : `${entero},${resto}`
  return negativo ? `-${texto}` : texto
}

/** Texto tecleado ("1,5") → milésimas. Devuelve null si no se entiende. */
export function aMilesimas(texto: string): bigint | null {
  const limpio = texto.trim().replace(',', '.')
  if (!/^\d*\.?\d{0,3}$/.test(limpio) || limpio === '' || limpio === '.') return null
  const [entero = '0', decimales = ''] = limpio.split('.')
  return BigInt(entero || '0') * 1000n + BigInt(decimales.padEnd(3, '0') || '0')
}

/** Texto tecleado de un importe → Money, o null. */
export function aMonto(texto: string, moneda: 'VES' | 'USD'): Money | null {
  const limpio = texto.trim().replace(/\./g, '').replace(',', '.')
  if (!/^\d*\.?\d{0,2}$/.test(limpio) || limpio === '' || limpio === '.') return null
  const [entero = '0', decimales = ''] = limpio.split('.')
  return money(moneda, BigInt(entero || '0') * 100n + BigInt(decimales.padEnd(2, '0') || '0'))
}
