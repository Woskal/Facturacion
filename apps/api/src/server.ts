import Fastify, { type FastifyInstance } from 'fastify'
import type { Database } from '@fve/db'
import { touchSession, verifySession } from '@fve/auth'

import { bearerToken, registerErrorHandler, serializeBigInts } from './http'
import { registerAuthRoutes } from './routes/auth'
import { registerPlatformRoutes } from './routes/platform'
import { registerBusinessRoutes } from './routes/business'

export interface BuildOptions {
  readonly db: Database
  readonly logger?: boolean
}

/** Rutas que se atienden sin sesión. Todo lo demás la exige. */
const PUBLIC_ROUTES = new Set(['/auth/login', '/health'])

export function buildServer(options: BuildOptions): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false })

  /**
   * Los montos viajan como texto en unidades menores, nunca como número.
   *
   * Un `number` de JavaScript es un float: serializar así anularía en el último
   * tramo toda la aritmética exacta del núcleo monetario. El cliente los
   * reconstruye con `@fve/money`, el mismo paquete que usa el servidor.
   */
  app.setReplySerializer((payload) => JSON.stringify(serializeBigInts(payload)))

  registerErrorHandler(app)

  /**
   * Resuelve la sesión en cada petición.
   *
   * Se valida contra la base todas las veces. Es una consulta por índice único y
   * es lo que hace que revocar una sesión surta efecto de inmediato en vez de
   * cuando expire un token.
   */
  app.addHook('onRequest', async (request) => {
    if (PUBLIC_ROUTES.has(request.url.split('?')[0] ?? '')) return

    const token = bearerToken(request)
    if (!token) return

    try {
      const session = await verifySession(options.db, token)
      request.ctx = {
        userId: session.userId,
        sessionId: session.sessionId,
        activeTenantId: session.activeTenantId,
      }
      // No se espera: marcar actividad no debe retrasar la respuesta.
      void touchSession(options.db, session.sessionId).catch(() => undefined)
    } catch {
      // Una sesión inválida deja la petición sin contexto. Las rutas que la
      // exigen responderán 401; no se falla aquí para no delatar qué rutas hay.
    }
  })

  app.get('/health', async () => ({ status: 'ok' }))

  registerAuthRoutes(app, options.db)
  registerPlatformRoutes(app, options.db)
  registerBusinessRoutes(app, options.db)

  return app
}
