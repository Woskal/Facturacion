/**
 * @fve/core — operaciones de negocio.
 *
 * Compone `@fve/money` (cálculo exacto) con `@fve/db` (persistencia aislada).
 * Aquí vive lo que el negocio hace: cargar la tasa del día, emitir una venta,
 * anularla, cuadrar la caja.
 *
 * Reglas transversales:
 *
 *  1. Toda operación que toca varias tablas ocurre en UNA transacción. Si algo
 *     falla no queda un consecutivo quemado ni un inventario descuadrado.
 *  2. Nada se calcula con la tasa de hoy si ocurrió otro día. La tasa se resuelve
 *     una vez, al principio, y se copia en el documento.
 *  3. Un documento se arma en borrador y se emite al final. A partir de ahí es
 *     inmutable, y lo hace cumplir la base de datos.
 */

export * from './errors'
export * from './rates'
export * from './reports'
export * from './numbering'
export * from './sales'
export * from './bcv'
export * from './cash'
export * from './catalog'
export * from './customers'
export * from './documents'
export * from './platform'
export * from './purchasing'
export * from './subscriptions'
