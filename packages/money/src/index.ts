/**
 * @fve/money — núcleo monetario del sistema.
 *
 * Reglas que no se negocian en ninguna parte del código que dependa de esto:
 *
 *  1. Todo monto es `bigint` en unidades menores. Nunca `number`, nunca float.
 *  2. Todo redondeo es explícito y pasa por `divideRound`.
 *  3. Todo monto se persiste junto a la tasa con que se calculó. Un histórico
 *     jamás se reconstruye con la tasa de hoy.
 *  4. El IVA se guarda desglosado en alícuota principal y adicional, porque así
 *     lo pide el libro de ventas.
 *  5. El IGTF grava el pago en divisa, no la venta, y va en línea aparte.
 */

export * from './errors'
export * from './rounding'
export * from './currency'
export * from './money'
export * from './rate'
export * from './tax'
export * from './payment'
export * from './format'
