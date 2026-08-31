import { relations } from 'drizzle-orm'
import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

import { archivedAt, createdAt, primaryId, updatedAt } from './columns'
import { idKind, memberRole } from './enums'

/**
 * Un negocio suscrito. Es la raíz de todo: cada fila del sistema salvo `users`
 * cuelga de un `tenant_id`.
 */
export const tenants = pgTable(
  'tenants',
  {
    id: primaryId(),
    name: text('name').notNull(),
    /** RIF del negocio: letra y número, guardados por separado para poder validar. */
    rifKind: idKind('rif_kind').notNull(),
    rifNumber: text('rif_number').notNull(),
    tradeName: text('trade_name'),
    /** Razón social, si difiere del nombre comercial. */
    legalName: text('legal_name'),
    address: text('address'),
    city: text('city'),
    phone: text('phone'),
    email: text('email'),
    website: text('website'),
    /**
     * Pie libre del documento: condiciones de pago, garantía, lo que el negocio
     * quiera decirle a su cliente. Va impreso al final de cada documento.
     */
    documentFooter: text('document_footer'),
    /** Si el negocio es contribuyente especial: cambia el tratamiento del IGTF. */
    specialTaxpayer: boolean('special_taxpayer').notNull().default(false),
    /** Alícuota de IGTF vigente para este negocio, en puntos básicos. */
    igtfBps: integer('igtf_bps').notNull().default(300),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  (table) => [uniqueIndex('tenants_rif_unique').on(table.rifKind, table.rifNumber)],
)

/**
 * Una persona. Existe por encima de los negocios: el mismo contador puede
 * atender varios clientes con una sola cuenta.
 */
export const users = pgTable(
  'users',
  {
    id: primaryId(),
    email: text('email').notNull(),
    fullName: text('full_name').notNull(),
    passwordHash: text('password_hash').notNull(),
    /** Intentos fallidos consecutivos. Se reinicia con cada ingreso correcto. */
    failedAttempts: integer('failed_attempts').notNull().default(0),
    /** Bloqueo temporal tras demasiados intentos fallidos. */
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    /**
     * Operador de la plataforma: quien da de alta negocios y les asigna
     * usuarios. Es una persona por encima de los negocios, no un rol dentro de
     * uno — por eso vive aquí y no en `memberships`.
     *
     * No concede acceso automático a los datos de nadie: para entrar a un
     * negocio hay que tener membresía en él, y crearla queda registrado en la
     * bitácora. El poder existe, pero deja rastro.
     */
    isPlatformAdmin: boolean('is_platform_admin').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  (table) => [uniqueIndex('users_email_unique').on(table.email)],
)

/**
 * Vínculo entre persona y negocio, con su rol.
 *
 * Aquí vive la promesa comercial de usuarios ilimitados: agregar un colaborador
 * es una fila más, nunca un cargo adicional.
 */
export const memberships = pgTable(
  'memberships',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: memberRole('role').notNull().default('OWNER'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  (table) => [
    uniqueIndex('memberships_tenant_user_unique').on(table.tenantId, table.userId),
    index('memberships_user_idx').on(table.userId),
  ],
)

/**
 * Una caja o terminal.
 *
 * Es entidad de primera clase aunque el negocio tenga una sola: de la estación
 * cuelgan los bloques de numeración reservados que hacen posible vender sin
 * conexión sin que dos cajas emitan el mismo consecutivo.
 */
export const stations = pgTable(
  'stations',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Código corto que se imprime en el documento para saber de qué caja salió. */
    code: text('code').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  (table) => [uniqueIndex('stations_tenant_code_unique').on(table.tenantId, table.code)],
)

export const tenantsRelations = relations(tenants, ({ many }) => ({
  memberships: many(memberships),
  stations: many(stations),
}))

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(memberships),
}))

export const membershipsRelations = relations(memberships, ({ one }) => ({
  tenant: one(tenants, { fields: [memberships.tenantId], references: [tenants.id] }),
  user: one(users, { fields: [memberships.userId], references: [users.id] }),
}))

export const stationsRelations = relations(stations, ({ one }) => ({
  tenant: one(tenants, { fields: [stations.tenantId], references: [tenants.id] }),
}))
