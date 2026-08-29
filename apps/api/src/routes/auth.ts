import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Database } from '@fve/db'
import { authenticate, changePassword, listMemberships, revokeSession, selectTenant } from '@fve/auth'

import { requireAuth } from '../http'

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  stationId: z.string().uuid().optional(),
})

const selectTenantSchema = z.object({ tenantId: z.string().uuid() })

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(12, 'La contraseña nueva debe tener al menos 12 caracteres.'),
})

export function registerAuthRoutes(app: FastifyInstance, db: Database): void {
  /**
   * Inicia sesión.
   *
   * Devuelve el token y los negocios de la persona, pero la sesión nace SIN
   * negocio activo aunque solo haya uno: elegirlo es un paso explícito, así el
   * mismo camino sirve para el dueño de una bodega y para quien atiende cinco.
   */
  app.post('/auth/login', async (request, reply) => {
    const body = loginSchema.parse(request.body)

    const result = await authenticate(db, {
      email: body.email,
      password: body.password,
      stationId: body.stationId,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    })

    return reply.send({
      token: result.session.token,
      expiresAt: result.session.expiresAt,
      user: { id: result.userId, fullName: result.fullName },
      memberships: result.memberships,
    })
  })

  app.get('/auth/me', async (request, reply) => {
    const ctx = requireAuth(request)
    const memberships = await listMemberships(db, ctx.userId)
    return reply.send({
      user: { id: ctx.userId },
      activeTenantId: ctx.activeTenantId,
      memberships,
    })
  })

  /** Selecciona el negocio activo. La membresía se valida contra la base. */
  app.post('/auth/select-tenant', async (request, reply) => {
    const ctx = requireAuth(request)
    const body = selectTenantSchema.parse(request.body)
    const selected = await selectTenant(db, ctx.sessionId, body.tenantId)
    return reply.send(selected)
  })

  app.post('/auth/logout', async (request, reply) => {
    const ctx = requireAuth(request)
    await revokeSession(db, ctx.sessionId)
    return reply.status(204).send()
  })

  /** Cambiar la contraseña cierra las demás sesiones y conserva la actual. */
  app.post('/auth/change-password', async (request, reply) => {
    const ctx = requireAuth(request)
    const body = changePasswordSchema.parse(request.body)

    await changePassword(db, {
      userId: ctx.userId,
      currentPassword: body.currentPassword,
      newPassword: body.newPassword,
      keepSessionId: ctx.sessionId,
    })

    return reply.status(204).send()
  })

  /** Comprobación de vida del token, para que el cliente sepa si sigue dentro. */
  app.get('/auth/session', async (request, reply) => {
    const ctx = requireAuth(request)
    return reply.send({ sessionId: ctx.sessionId, activeTenantId: ctx.activeTenantId })
  })
}
