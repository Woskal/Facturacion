import { sql } from 'drizzle-orm'
import { bigint, timestamp, uuid } from 'drizzle-orm/pg-core'

/** Clave primaria estándar. */
export const primaryId = () => uuid('id').primaryKey().default(sql`gen_random_uuid()`)

/**
 * Columna de monto.
 *
 * Siempre `bigint` en unidades menores, nunca `numeric` ni `double`. El driver
 * de Postgres devuelve `bigint` como texto y `@fve/money` lo convierte a
 * `bigint` de JavaScript: en ningún punto del camino existe un float.
 */
export const amount = (name: string) => bigint(name, { mode: 'bigint' })

/**
 * Columna de tasa: bolívares por dólar escalados 1e8, igual que `RATE_SCALE` de
 * `@fve/money`. Guardarla como entero evita que la tasa sea el float que
 * contamina todo lo demás.
 */
export const rateScaled = (name: string) => bigint(name, { mode: 'bigint' })

export const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()

export const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()

/**
 * Borrado lógico. Nada del dominio se borra físicamente: un producto retirado
 * sigue apareciendo en las ventas del año pasado.
 */
export const archivedAt = () => timestamp('archived_at', { withTimezone: true })
