import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Database } from '@fve/db'
import {
  attachUserToTenant,
  enforceSubscriptions,
  getSubscription,
  listSubscriptionPayments,
  listSubscriptions,
  registerSubscriptionPayment,
  updateSubscription,
  createTenant,
  createUser,
  detachUserFromTenant,
  grantPlatformAdmin,
  listTenantUsers,
  listTenants,
  reactivateTenant,
  suspendTenant,
} from '@fve/core'

import { moneySchema, requireAuth, requireTenant } from '../http'

const idKindSchema = z.enum(['V', 'E', 'J', 'G', 'P'])

const createTenantSchema = z.object({
  name: z.string().min(1),
  rifKind: idKindSchema,
  rifNumber: z.string().min(1),
  tradeName: z.string().optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  specialTaxpayer: z.boolean().optional(),
  igtfBps: z.number().int().min(0).max(10000).optional(),
})

const createUserSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(1),
  password: z.string().min(12, 'La contraseña debe tener al menos 12 caracteres.'),
  tenantId: z.string().uuid().optional(),
})

const tenantParams = z.object({ tenantId: z.string().uuid() })
const membershipParams = z.object({ tenantId: z.string().uuid(), userId: z.string().uuid() })

/**
 * Rutas del operador de la plataforma.
 *
 * Cada una vuelve a comprobar la condición de operador contra la base, dentro
 * de `@fve/core`. No basta con que la sesión diga que lo es: quitarle esa
 * condición a alguien tiene que surtir efecto de inmediato.
 */
export function registerPlatformRoutes(app: FastifyInstance, db: Database): void {
  app.get('/platform/tenants', async (request, reply) => {
    const ctx = requireAuth(request)
    return reply.send({ tenants: await listTenants(db, ctx.userId) })
  })

  app.post('/platform/tenants', async (request, reply) => {
    const ctx = requireAuth(request)
    const body = createTenantSchema.parse(request.body)
    const created = await createTenant(db, { actorUserId: ctx.userId, ...body })
    return reply.status(201).send(created)
  })

  app.get('/platform/tenants/:tenantId/users', async (request, reply) => {
    const ctx = requireAuth(request)
    const params = tenantParams.parse(request.params)
    return reply.send({ users: await listTenantUsers(db, ctx.userId, params.tenantId) })
  })

  app.post('/platform/users', async (request, reply) => {
    const ctx = requireAuth(request)
    const body = createUserSchema.parse(request.body)
    const created = await createUser(db, { actorUserId: ctx.userId, ...body })
    return reply.status(201).send(created)
  })

  app.put('/platform/tenants/:tenantId/users/:userId', async (request, reply) => {
    const ctx = requireAuth(request)
    const params = membershipParams.parse(request.params)
    await attachUserToTenant(db, { actorUserId: ctx.userId, ...params })
    return reply.status(204).send()
  })

  app.delete('/platform/tenants/:tenantId/users/:userId', async (request, reply) => {
    const ctx = requireAuth(request)
    const params = membershipParams.parse(request.params)
    await detachUserFromTenant(db, { actorUserId: ctx.userId, ...params })
    return reply.status(204).send()
  })

  /** Suspender corta el acceso y cierra sesiones, pero no borra nada. */
  app.post('/platform/tenants/:tenantId/suspend', async (request, reply) => {
    const ctx = requireAuth(request)
    const params = tenantParams.parse(request.params)
    await suspendTenant(db, { actorUserId: ctx.userId, tenantId: params.tenantId })
    return reply.status(204).send()
  })

  app.post('/platform/tenants/:tenantId/reactivate', async (request, reply) => {
    const ctx = requireAuth(request)
    const params = tenantParams.parse(request.params)
    await reactivateTenant(db, { actorUserId: ctx.userId, tenantId: params.tenantId })
    return reply.status(204).send()
  })

  // --- Cobranza -------------------------------------------------------------

  /** Panel de cobranza: ordenado por lo que vence primero. */
  app.get('/platform/subscriptions', async (request, reply) => {
    const ctx = requireAuth(request)
    return reply.send({ subscriptions: await listSubscriptions(db, ctx.userId) })
  })

  app.get('/platform/tenants/:tenantId/subscription', async (request, reply) => {
    const ctx = requireAuth(request)
    const params = tenantParams.parse(request.params)
    const [subscription, payments] = await Promise.all([
      getSubscription(db, params.tenantId),
      listSubscriptionPayments(db, { tenantId: params.tenantId, actorUserId: ctx.userId }),
    ])
    return reply.send({ subscription, payments })
  })

  /**
   * Registra un pago y extiende el servicio.
   *
   * El pago llega por fuera —pago móvil, Zelle, USDT— y alguien revisa el
   * comprobante. Por eso la referencia y quién lo dio por bueno quedan
   * guardados: es lo único que permite reconstruir una cobranza discutida.
   */
  app.post('/platform/tenants/:tenantId/subscription/payments', async (request, reply) => {
    const ctx = requireAuth(request)
    const params = tenantParams.parse(request.params)
    const body = z
      .object({
        amount: moneySchema,
        method: z.enum([
          'EFECTIVO_BS',
          'EFECTIVO_USD',
          'PAGO_MOVIL',
          'TRANSFERENCIA_BS',
          'PUNTO_VENTA',
          'ZELLE',
          'USDT',
        ]),
        reference: z.string().optional(),
        periods: z.number().int().min(1).max(24).optional(),
      })
      .parse(request.body)

    const subscription = await registerSubscriptionPayment(db, {
      tenantId: params.tenantId,
      actorUserId: ctx.userId,
      ...body,
    })

    return reply.status(201).send({ subscription })
  })

  app.patch('/platform/tenants/:tenantId/subscription', async (request, reply) => {
    const ctx = requireAuth(request)
    const params = tenantParams.parse(request.params)
    const body = z
      .object({
        period: z.enum(['MENSUAL', 'SEMESTRAL', 'ANUAL']).optional(),
        priceUsd: moneySchema.optional(),
        graceDays: z.number().int().min(0).max(60).optional(),
        notes: z.string().optional(),
      })
      .parse(request.body)

    await updateSubscription(db, { tenantId: params.tenantId, actorUserId: ctx.userId, ...body })
    return reply.status(204).send()
  })

  /** Corre el corte a mano. También corre solo una vez al día. */
  app.post('/platform/subscriptions/enforce', async (request, reply) => {
    const ctx = requireAuth(request)
    await listSubscriptions(db, ctx.userId)
    return reply.send({ result: await enforceSubscriptions(db) })
  })

  /** Lo que el propio negocio ve de su suscripción. */
  app.get('/subscription', async (request, reply) => {
    const ctx = requireTenant(request)
    return reply.send({ subscription: await getSubscription(db, ctx.activeTenantId) })
  })

  app.post('/platform/admins/:userId', async (request, reply) => {
    const ctx = requireAuth(request)
    const params = z.object({ userId: z.string().uuid() }).parse(request.params)
    await grantPlatformAdmin(db, { actorUserId: ctx.userId, userId: params.userId })
    return reply.status(204).send()
  })
}
