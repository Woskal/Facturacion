import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { money, type Currency, type Money } from '@fve/money'
import { MoneyError } from '@fve/money'
import { AuthError, InvalidSessionError, MembershipRequiredError } from '@fve/auth'
import {
  CoreError,
  CustomerNotFoundError,
  DocumentNotFoundError,
  DuplicateCustomerError,
  DuplicateSkuError,
  DuplicateSupplierError,
  NotPlatformAdminError,
  PurchaseNotFoundError,
  ReceivableNotFoundError,
  SupplierNotFoundError,
  TenantAlreadyExistsError,
  TenantNotFoundError,
  UserAlreadyExistsError,
} from '@fve/core'

/**
 * Serialización de montos.
 *
 * Los importes viajan como texto en unidades menores, nunca como número: un
 * `number` de JavaScript es un float, y mandar 0.1 + 0.2 por la red anularía
 * toda la aritmética exacta del núcleo monetario justo en el último tramo.
 *
 * El cliente los reconstruye con `@fve/money`, que es el mismo paquete que usa
 * el servidor. Los dos lados hablan el mismo idioma.
 */
export function serializeBigInts(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString()
  if (Array.isArray(value)) return value.map(serializeBigInts)
  if (value instanceof Date) return value.toISOString()
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serializeBigInts(item)]))
  }
  return value
}

export const currencySchema = z.enum(['VES', 'USD'])

/** Monto en unidades menores, como texto. */
export const moneySchema = z
  .object({
    currency: currencySchema,
    amount: z.string().regex(/^-?\d+$/, 'El monto debe ser un entero en unidades menores.'),
  })
  .transform((value): Money => money(value.currency as Currency, BigInt(value.amount)))

/** Cantidad en milésimas, como texto. */
export const quantitySchema = z
  .string()
  .regex(/^-?\d+$/, 'La cantidad debe ser un entero en milésimas.')
  .transform((value) => BigInt(value))

/** El momento que declara una venta sincronizada no es aceptable. */
export class SaleTimestampError extends Error {
  override readonly name = 'SaleTimestampError'
}

export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Se espera una fecha YYYY-MM-DD.')

/**
 * Traduce los errores del dominio a códigos HTTP.
 *
 * Los errores no previstos salen como 500 con un mensaje genérico: el detalle va
 * al registro del servidor, no a la respuesta. Un mensaje de error de base de
 * datos filtrado al cliente le enseña a un atacante la forma del esquema.
 */
export function statusForError(error: unknown): { status: number; message: string } | null {
  if (error instanceof InvalidSessionError) return { status: 401, message: error.message }
  if (error instanceof MembershipRequiredError) return { status: 403, message: error.message }
  if (error instanceof NotPlatformAdminError) return { status: 403, message: error.message }
  if (error instanceof AuthError) return { status: 401, message: error.message }

  if (
    error instanceof DocumentNotFoundError ||
    error instanceof CustomerNotFoundError ||
    error instanceof ReceivableNotFoundError ||
    error instanceof SupplierNotFoundError ||
    error instanceof PurchaseNotFoundError ||
    error instanceof TenantNotFoundError
  ) {
    return { status: 404, message: error.message }
  }

  if (
    error instanceof DuplicateSkuError ||
    error instanceof DuplicateCustomerError ||
    error instanceof DuplicateSupplierError ||
    error instanceof TenantAlreadyExistsError ||
    error instanceof UserAlreadyExistsError
  ) {
    return { status: 409, message: error.message }
  }

  if (error instanceof SaleTimestampError) {
    return { status: 422, message: error.message }
  }

  if (error instanceof CoreError || error instanceof MoneyError) {
    return { status: 422, message: error.message }
  }

  return null
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof z.ZodError) {
      return reply.status(400).send({
        error: 'Datos inválidos.',
        details: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      })
    }

    const mapped = statusForError(error)
    if (mapped) {
      return reply.status(mapped.status).send({ error: mapped.message })
    }

    request.log.error({ err: error }, 'error no controlado')
    return reply.status(500).send({ error: 'Error interno del servidor.' })
  })
}

export interface RequestContext {
  readonly userId: string
  readonly sessionId: string
  readonly activeTenantId: string | null
}

declare module 'fastify' {
  interface FastifyRequest {
    ctx?: RequestContext
  }
}

/** Contexto de la petición, o error si la ruta exige sesión y no la hay. */
export function requireAuth(request: FastifyRequest): RequestContext {
  if (!request.ctx) throw new InvalidSessionError()
  return request.ctx
}

/** Contexto con negocio ya seleccionado. */
export function requireTenant(request: FastifyRequest): RequestContext & { activeTenantId: string } {
  const ctx = requireAuth(request)
  if (!ctx.activeTenantId) {
    throw new MembershipRequiredError()
  }
  return { ...ctx, activeTenantId: ctx.activeTenantId }
}

export function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization
  if (!header) return null
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match?.[1] ?? null
}

export function noContent(reply: FastifyReply): FastifyReply {
  return reply.status(204).send()
}
