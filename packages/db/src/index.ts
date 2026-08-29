/**
 * @fve/db — esquema y acceso a datos.
 *
 * Reglas estructurales:
 *
 *  1. Todo monto es una columna `bigint` en unidades menores, nunca `numeric`
 *     ni `double`. La conversión la hace `@fve/money`.
 *  2. Cada documento guarda la tasa con que se calculó, copiada además de
 *     referenciada, para que corregir la tasa del día no altere lo ya emitido.
 *  3. Un documento emitido es inmutable. Se anula o se corrige con nota de
 *     crédito; nunca se edita ni se borra.
 *  4. El desglose por alícuota se persiste con el documento. No se recalcula.
 *  5. El aislamiento entre negocios lo hace cumplir Postgres con seguridad por
 *     fila, no el código de acceso a datos.
 */

export * as schema from './schema/index'
export * from './schema/index'
export * from './client'
export { TENANT_SCOPED_TABLES } from './tenancy'
