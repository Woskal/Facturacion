import { sql } from 'drizzle-orm'
import { createDatabase, schema, withTenant, type Database } from '@fve/db'

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
      document_series, purchase_lines, purchases, suppliers,
      customers, product_prices, products, price_lists,
      tax_rates, exchange_rates, station_credentials, sessions, stations,
      memberships, users, tenants
    RESTART IDENTITY CASCADE
  `)
}

export interface Negocio {
  tenantId: string
  userId: string
  stationId: string
  seriesId: string
  priceListId: string
  customerId: string
  /** Alícuota general 16%. */
  ivaGeneral: string
  /** Alícuota exenta. */
  ivaExento: string
  /** Harina, $1,50 con IVA incluido, general. */
  harina: string
  /** Pan, $2,00 con IVA incluido, exento. */
  pan: string
  /** Servicio sin inventario, $10,00 sin IVA. */
  servicio: string
}

/** Siembra un negocio completo listo para vender. */
export async function seedNegocio(db: Database, suffix = '1'): Promise<Negocio> {
  const [tenant] = await db
    .insert(schema.tenants)
    .values({ name: `Bodega ${suffix}`, rifKind: 'J', rifNumber: `3000000${suffix}` })
    .returning({ id: schema.tenants.id })

  const [user] = await db
    .insert(schema.users)
    .values({ email: `duenio${suffix}@ejemplo.ve`, fullName: 'Dueño', passwordHash: 'x' })
    .returning({ id: schema.users.id })

  if (!tenant || !user) throw new Error('No se pudo sembrar el negocio.')

  return withTenant(db, tenant.id, async (tx) => {
    const tenantId = tenant.id
    await tx.insert(schema.memberships).values({ tenantId, userId: user.id, role: 'OWNER' })

    const [station] = await tx
      .insert(schema.stations)
      .values({ tenantId, name: 'Caja 1', code: 'C1' })
      .returning({ id: schema.stations.id })

    const [general] = await tx
      .insert(schema.taxRates)
      .values({ tenantId, code: 'G', name: 'General 16%', baseBps: 1600, isDefault: true })
      .returning({ id: schema.taxRates.id })

    const [exento] = await tx
      .insert(schema.taxRates)
      .values({ tenantId, code: 'E', name: 'Exento', baseBps: 0 })
      .returning({ id: schema.taxRates.id })

    const [priceList] = await tx
      .insert(schema.priceLists)
      .values({ tenantId, name: 'Detal', isDefault: true })
      .returning({ id: schema.priceLists.id })

    const [series] = await tx
      .insert(schema.documentSeries)
      .values({ tenantId, kind: 'NOTA_ENTREGA', prefix: 'NE', nextNumber: 1 })
      .returning({ id: schema.documentSeries.id })

    const [customer] = await tx
      .insert(schema.customers)
      .values({ tenantId, idKind: 'V', idNumber: '12345678', name: 'María Pérez' })
      .returning({ id: schema.customers.id })

    if (!station || !general || !exento || !priceList || !series || !customer) {
      throw new Error('No se pudo sembrar el negocio.')
    }

    const crearProducto = async (
      sku: string,
      name: string,
      taxRateId: string,
      priceMode: 'IVA_INCLUIDO' | 'IVA_EXCLUIDO',
      unitPrice: bigint,
      tracksStock: boolean,
    ) => {
      const [product] = await tx
        .insert(schema.products)
        .values({ tenantId, sku, name, taxRateId, priceMode, tracksStock })
        .returning({ id: schema.products.id })
      if (!product) throw new Error('No se pudo crear el producto.')
      await tx.insert(schema.productPrices).values({
        tenantId,
        productId: product.id,
        priceListId: priceList.id,
        currency: 'USD',
        unitPrice,
      })
      return product.id
    }

    const harina = await crearProducto('HAR-1', 'Harina de maíz 1 kg', general.id, 'IVA_INCLUIDO', 150n, true)
    const pan = await crearProducto('PAN-1', 'Pan canilla', exento.id, 'IVA_INCLUIDO', 200n, true)
    const servicio = await crearProducto('SER-1', 'Instalación', general.id, 'IVA_EXCLUIDO', 1000n, false)

    return {
      tenantId,
      userId: user.id,
      stationId: station.id,
      seriesId: series.id,
      priceListId: priceList.id,
      customerId: customer.id,
      ivaGeneral: general.id,
      ivaExento: exento.id,
      harina,
      pan,
      servicio,
    }
  })
}

/** Existencia actual de un producto, derivada de sus movimientos. */
export async function stockOf(db: Database, tenantId: string, productId: string): Promise<bigint> {
  const rows = await withTenant(db, tenantId, (tx) =>
    tx.execute<{ total: string | null }>(sql`
      SELECT COALESCE(SUM(quantity), 0)::text AS total
      FROM stock_movements WHERE product_id = ${productId}
    `),
  )
  return BigInt([...rows][0]?.total ?? '0')
}
