import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

import { createdAt, primaryId } from './columns'
import { auditAction } from './enums'
import { tenants, users } from './tenancy'

/**
 * Bitácora de auditoría.
 *
 * Registra quién hizo qué, cuándo y desde dónde, con el estado anterior y el
 * posterior. Es de solo inserción: nada la edita ni la borra.
 *
 * Existe desde la Fase 0 aunque el sistema todavía no emita documentos
 * fiscales. La trazabilidad completa por usuario es uno de los requisitos
 * técnicos de la homologación ante el SENIAT, y reconstruir un histórico de
 * auditoría que no se fue guardando es sencillamente imposible.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    action: auditAction('action').notNull(),
    /** Nombre de la tabla afectada. */
    entity: text('entity').notNull(),
    entityId: uuid('entity_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (table) => [
    index('audit_log_tenant_occurred_idx').on(table.tenantId, table.occurredAt),
    index('audit_log_entity_idx').on(table.entity, table.entityId),
  ],
)
