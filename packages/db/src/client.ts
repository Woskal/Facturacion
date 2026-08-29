import { sql } from 'drizzle-orm'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

import * as schema from './schema/index'

export type Database = PostgresJsDatabase<typeof schema>

export interface ConnectOptions {
  readonly url: string
  readonly max?: number
  readonly logger?: boolean
}

/**
 * Abre la conexión.
 *
 * El rol con que conecta la aplicación **no debe ser superusuario**: un
 * superusuario ignora las políticas de seguridad por fila y el aislamiento entre
 * negocios dejaría de existir sin que nada falle visiblemente.
 */
export function createDatabase(options: ConnectOptions): { db: Database; close: () => Promise<void> } {
  // Las columnas de monto son `bigint` y el driver las entrega como texto;
  // Drizzle las convierte a `bigint` de JavaScript. En ningún punto del camino
  // el monto pasa por el float que representa `number`.
  const client = postgres(options.url, { max: options.max ?? 10 })

  const db = drizzle(client, { schema, logger: options.logger ?? false })

  return { db, close: () => client.end() }
}

/**
 * Ejecuta trabajo dentro del contexto de un negocio.
 *
 * Abre una transacción, fija `app.tenant_id` para esa transacción y corre el
 * callback. Las políticas de seguridad por fila leen esa variable, de modo que
 * una consulta que olvide filtrar por `tenant_id` no devuelve datos ajenos:
 * devuelve nada.
 *
 * El aislamiento se hace cumplir en la base de datos y no en el código de
 * acceso a datos justamente porque el código se olvida. La base, no.
 */
export async function withTenant<T>(
  db: Database,
  tenantId: string,
  work: (tx: Parameters<Parameters<Database['transaction']>[0]>[0]) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`)
    return work(tx)
  })
}

/**
 * Ejecuta trabajo en nombre de una persona, sin negocio activo.
 *
 * Es lo que usa el login para leer las membresías de alguien antes de saber a
 * qué negocio va a entrar. Solo habilita la política `memberships_self_read`,
 * que permite leer las propias membresías y nada más.
 *
 * No sustituye a `withTenant`: una vez elegido el negocio, todo lo demás pasa
 * por el contexto de negocio como siempre.
 */
export async function withUser<T>(
  db: Database,
  userId: string,
  work: (tx: Parameters<Parameters<Database['transaction']>[0]>[0]) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`)
    return work(tx)
  })
}

/**
 * Ejecuta trabajo sin contexto de negocio, para tareas de plataforma: registrar
 * un negocio nuevo, migrar, administrar suscripciones. Debe usarse poco y
 * conscientemente.
 */
export async function withoutTenant<T>(db: Database, work: (db: Database) => Promise<T>): Promise<T> {
  return work(db)
}
