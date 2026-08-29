import { createDatabase } from '@fve/db'

import { buildServer } from './server'

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
