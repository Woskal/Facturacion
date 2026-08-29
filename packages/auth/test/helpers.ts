import { sql } from 'drizzle-orm'
import { createDatabase, schema, withTenant, type Database } from '@fve/db'

import { hashPassword } from '../src/password'

export function connect() {
  const url = process.env['DATABASE_URL']
  if (!url) throw new Error('Falta DATABASE_URL. Copie packages/db/.env.example a .env.')
  return createDatabase({ url })
}

export async function resetDatabase(db: Database): Promise<void> {
  await db.execute(sql`
    TRUNCATE TABLE
      audit_log, cash_counts, cash_sessions, receivable_entries, receivables,
      expenses, expense_categories, stock_movements, document_payments,
      document_tax_breakdown, document_lines, documents, number_reservations,
      document_series, customers, product_prices, products, price_lists,
      tax_rates, exchange_rates, station_credentials, sessions, stations,
      memberships, users, tenants
    RESTART IDENTITY CASCADE
  `)
}

export const CLAVE = 'una-clave-larga-y-decente'

export async function createUser(db: Database, email: string, name = 'Persona'): Promise<string> {
  const [user] = await db
    .insert(schema.users)
    .values({ email, fullName: name, passwordHash: await hashPassword(CLAVE) })
    .returning({ id: schema.users.id })
  if (!user) throw new Error('No se pudo crear el usuario.')
  return user.id
}

export async function createTenant(db: Database, suffix: string): Promise<string> {
  const [tenant] = await db
    .insert(schema.tenants)
    .values({ name: `Negocio ${suffix}`, rifKind: 'J', rifNumber: `5000000${suffix}` })
    .returning({ id: schema.tenants.id })
  if (!tenant) throw new Error('No se pudo crear el negocio.')
  return tenant.id
}

export async function addMembership(
  db: Database,
  tenantId: string,
  userId: string,
  role: 'OWNER' | 'ADMIN' | 'CASHIER' | 'VIEWER' = 'OWNER',
): Promise<void> {
  await withTenant(db, tenantId, async (tx) => {
    await tx.insert(schema.memberships).values({ tenantId, userId, role })
  })
}

export async function createStation(db: Database, tenantId: string, code = 'C1'): Promise<string> {
  return withTenant(db, tenantId, async (tx) => {
    const [station] = await tx
      .insert(schema.stations)
      .values({ tenantId, name: `Caja ${code}`, code })
      .returning({ id: schema.stations.id })
    if (!station) throw new Error('No se pudo crear la estación.')
    return station.id
  })
}
