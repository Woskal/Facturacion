import { sql } from 'drizzle-orm'

import { createDatabase, withTenant, type Database } from '../src/client'
import * as schema from '../src/schema/index'

export function connect() {
  const url = process.env['DATABASE_URL']
  if (!url) {
    throw new Error('Falta DATABASE_URL. Copie packages/db/.env.example a .env.')
  }
  return createDatabase({ url })
}

/** Deja la base vacía. TRUNCATE no pasa por las políticas de seguridad por fila. */
export async function resetDatabase(db: Database): Promise<void> {
  await db.execute(sql`
    TRUNCATE TABLE
      audit_log, cash_counts, cash_sessions, receivable_entries, receivables,
      expenses, expense_categories, stock_movements, document_payments,
      document_tax_breakdown, document_lines, documents, number_reservations,
      document_series, purchase_payments, purchase_lines, purchases, suppliers,
      customers, product_prices, products, price_lists,
      tax_rates, exchange_rates, station_credentials, sessions, stations,
      memberships, users, tenants
    RESTART IDENTITY CASCADE
  `)
}

export interface SeededTenant {
  tenantId: string
  userId: string
  stationId: string
  taxRateId: string
  priceListId: string
  exchangeRateId: string
  seriesId: string
  productId: string
}

/**
 * Crea un negocio completo listo para vender.
 *
 * `tenants` y `users` se insertan sin contexto de negocio porque no están
 * alcanzados por el aislamiento: un negocio es la raíz y una persona vive por
 * encima de los negocios.
 */
export async function seedTenant(db: Database, suffix: string): Promise<SeededTenant> {
  const [tenant] = await db
    .insert(schema.tenants)
    .values({ name: `Negocio ${suffix}`, rifKind: 'J', rifNumber: `4000000${suffix}` })
    .returning({ id: schema.tenants.id })

  const [user] = await db
    .insert(schema.users)
    .values({ email: `duenio${suffix}@ejemplo.ve`, fullName: `Dueño ${suffix}`, passwordHash: 'x' })
    .returning({ id: schema.users.id })

  if (!tenant || !user) throw new Error('No se pudo sembrar el negocio.')

  return withTenant(db, tenant.id, async (tx) => {
    await tx.insert(schema.memberships).values({ tenantId: tenant.id, userId: user.id, role: 'OWNER' })

    const [station] = await tx
      .insert(schema.stations)
      .values({ tenantId: tenant.id, name: 'Caja 1', code: 'C1' })
      .returning({ id: schema.stations.id })

    const [taxRate] = await tx
      .insert(schema.taxRates)
      .values({ tenantId: tenant.id, code: 'G', name: 'General 16%', baseBps: 1600, isDefault: true })
      .returning({ id: schema.taxRates.id })

    const [priceList] = await tx
      .insert(schema.priceLists)
      .values({ tenantId: tenant.id, name: 'Detal', isDefault: true })
      .returning({ id: schema.priceLists.id })

    const [rate] = await tx
      .insert(schema.exchangeRates)
      .values({ tenantId: tenant.id, bsPerUsd: 3658420000n, effectiveOn: '2026-08-28', source: 'BCV' })
      .returning({ id: schema.exchangeRates.id })

    const [series] = await tx
      .insert(schema.documentSeries)
      .values({ tenantId: tenant.id, kind: 'NOTA_ENTREGA', prefix: 'NE', nextNumber: 1 })
      .returning({ id: schema.documentSeries.id })

    if (!station || !taxRate || !priceList || !rate || !series) {
      throw new Error('No se pudo sembrar el negocio.')
    }

    const [product] = await tx
      .insert(schema.products)
      .values({
        tenantId: tenant.id,
        sku: 'SKU-1',
        name: 'Harina de maíz 1 kg',
        taxRateId: taxRate.id,
        priceMode: 'IVA_INCLUIDO',
      })
      .returning({ id: schema.products.id })

    if (!product) throw new Error('No se pudo sembrar el producto.')

    await tx.insert(schema.productPrices).values({
      tenantId: tenant.id,
      productId: product.id,
      priceListId: priceList.id,
      currency: 'USD',
      unitPrice: 150n,
    })

    return {
      tenantId: tenant.id,
      userId: user.id,
      stationId: station.id,
      taxRateId: taxRate.id,
      priceListId: priceList.id,
      exchangeRateId: rate.id,
      seriesId: series.id,
      productId: product.id,
    }
  })
}

/** Emite una nota de entrega mínima y devuelve su id. */
export async function issueDocument(db: Database, seed: SeededTenant, number: number): Promise<string> {
  return withTenant(db, seed.tenantId, async (tx) => {
    const [doc] = await tx
      .insert(schema.documents)
      .values({
        tenantId: seed.tenantId,
        kind: 'NOTA_ENTREGA',
        seriesId: seed.seriesId,
        number,
        fullNumber: `NE-${String(number).padStart(6, '0')}`,
        stationId: seed.stationId,
        issuedByUserId: seed.userId,
        status: 'ISSUED',
        issuedAt: new Date(),
        currency: 'USD',
        exchangeRateId: seed.exchangeRateId,
        rateBsPerUsd: 3658420000n,
        rateEffectiveOn: '2026-08-28',
        totalUsd: 10000n,
        totalVes: 365842n,
        grandTotalUsd: 10000n,
        grandTotalVes: 365842n,
      })
      .returning({ id: schema.documents.id })

    if (!doc) throw new Error('No se pudo emitir el documento.')
    return doc.id
  })
}
