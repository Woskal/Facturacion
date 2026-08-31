import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import { createDatabase } from '@fve/db'

import { buildServer } from './server'

/**
 * Carga `apps/api/.env` si existe, sin depender de un paquete externo.
 *
 * Solo rellena variables que no vengan ya del entorno, así que lo que se pase
 * por línea de comandos o en producción siempre manda sobre el archivo.
 */
const envPath = resolve(dirname(fileURLToPath(import.meta.url)), '../.env')
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(line)
    if (match?.[1] && process.env[match[1]] === undefined) {
      process.env[match[1]] = (match[2] ?? '').replace(/^["']|["']$/g, '')
    }
  }
}

const url = process.env['DATABASE_URL']
if (!url) {
  console.error('Falta DATABASE_URL.')
  process.exit(1)
}

const port = Number(process.env['PORT'] ?? 3001)
const host = process.env['HOST'] ?? '127.0.0.1'

const { db, close } = createDatabase({ url })
const app = buildServer({
  db,
  logger: true,
  syncRates: process.env['BCV_SYNC'] !== 'off',
  syncMinutes: process.env['BCV_SYNC_MINUTES'] ? Number(process.env['BCV_SYNC_MINUTES']) : undefined,
})

const shutdown = async (signal: string) => {
  app.log.info(`recibido ${signal}, cerrando`)
  await app.close()
  await close()
  process.exit(0)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))

await app.listen({ port, host })
