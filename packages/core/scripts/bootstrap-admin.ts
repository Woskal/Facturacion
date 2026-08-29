/**
 * Crea el primer operador de la plataforma.
 *
 * Existe porque hay un problema del huevo y la gallina: solo un operador puede
 * nombrar a otro, así que el primero tiene que crearse fuera de la aplicación.
 * Este script corre en el servidor, con acceso a la base, y no está expuesto por
 * ninguna ruta HTTP — que es justamente el punto.
 *
 *   npm run bootstrap-admin --workspace=@fve/core -- correo@ejemplo.ve "Nombre"
 *
 * La contraseña se pide por entrada estándar para que no quede en el historial
 * del intérprete de comandos.
 */
import { createInterface } from 'node:readline/promises'
import { eq } from 'drizzle-orm'

import { createDatabase, schema } from '@fve/db'
import { hashPassword } from '@fve/auth'

const [email, fullName] = process.argv.slice(2)

if (!email || !fullName) {
  console.error('Uso: npm run bootstrap-admin --workspace=@fve/core -- <correo> "<nombre completo>"')
  process.exit(1)
}

const url = process.env['DATABASE_URL']
if (!url) {
  console.error('Falta DATABASE_URL.')
  process.exit(1)
}

const rl = createInterface({ input: process.stdin, output: process.stdout })
const password = await rl.question('Contraseña del operador: ')
rl.close()

if (password.trim().length < 12) {
  console.error('La contraseña del operador debe tener al menos 12 caracteres.')
  process.exit(1)
}

const { db, close } = createDatabase({ url })

try {
  const normalized = email.trim().toLowerCase()
  const existing = await db.select().from(schema.users).where(eq(schema.users.email, normalized)).limit(1)

  if (existing[0]) {
    // Ya existe: se le concede la condición de operador en vez de fallar. Es lo
    // útil cuando alguien creó la cuenta y solo falta ascenderla.
    await db.update(schema.users).set({ isPlatformAdmin: true }).where(eq(schema.users.id, existing[0].id))
    console.log(`La cuenta ${normalized} ya existía y ahora es operador de la plataforma.`)
  } else {
    const [created] = await db
      .insert(schema.users)
      .values({
        email: normalized,
        fullName,
        passwordHash: await hashPassword(password),
        isPlatformAdmin: true,
      })
      .returning({ id: schema.users.id })

    console.log(`Operador creado: ${normalized} (${created?.id})`)
  }
} finally {
  await close()
}
