import { and, eq, isNull, sql } from 'drizzle-orm'
import { schema, withTenant, type Database } from '@fve/db'
import { money, type Currency, type Money } from '@fve/money'

import { CoreError, ProductUnavailableError } from './errors'

export class DuplicateSkuError extends CoreError {
  override readonly name = 'DuplicateSkuError'
  constructor(readonly sku: string) {
    super(`Ya existe un producto con el código ${sku}.`)
  }
}

export type PriceMode = 'IVA_INCLUIDO' | 'IVA_EXCLUIDO'

export interface CreateProductInput {
  readonly tenantId: string
  readonly userId: string
  readonly sku: string
  readonly name: string
  readonly taxRateId: string
  readonly price: Money
  readonly barcode?: string | undefined
  readonly unit?: string | undefined
  readonly priceMode?: PriceMode | undefined
  readonly tracksStock?: boolean | undefined
  /** Existencia mínima en milésimas. Dispara la alerta de reposición. */
  readonly minStock?: bigint | undefined
  /** Existencia inicial en milésimas. */
  readonly initialStock?: bigint | undefined
  readonly now?: Date | undefined
}

/**
 * Da de alta un producto con su precio.
 *
 * El precio se ancla en una moneda concreta —normalmente dólares, que es como
 * piensa el precio un comerciante venezolano— y el importe en la otra se calcula
 * con la tasa del día al vender. Nunca se guarda un precio en bolívares
 * convertido de antemano: al día siguiente estaría mal.
 */
export async function createProduct(
  db: Database,
  input: CreateProductInput,
): Promise<{ productId: string }> {
  const now = input.now ?? new Date()

  return withTenant(db, input.tenantId, async (tx) => {
    const existing = await tx
      .select({ id: schema.products.id })
      .from(schema.products)
      .where(and(eq(schema.products.tenantId, input.tenantId), eq(schema.products.sku, input.sku)))
      .limit(1)

    if (existing[0]) throw new DuplicateSkuError(input.sku)

    const [product] = await tx
      .insert(schema.products)
      .values({
        tenantId: input.tenantId,
        sku: input.sku,
        name: input.name,
        barcode: input.barcode ?? null,
        unit: input.unit ?? 'UND',
        taxRateId: input.taxRateId,
        priceMode: input.priceMode ?? 'IVA_INCLUIDO',
        tracksStock: input.tracksStock ?? true,
        minStock: input.minStock ?? 0n,
      })
      .returning({ id: schema.products.id })

    if (!product) throw new ProductUnavailableError('No se pudo crear el producto.')

    const lists = await tx
      .select({ id: schema.priceLists.id })
      .from(schema.priceLists)
      .where(and(eq(schema.priceLists.tenantId, input.tenantId), eq(schema.priceLists.isDefault, true)))
      .limit(1)

    const priceList = lists[0]
    if (!priceList) throw new ProductUnavailableError('El negocio no tiene lista de precios predeterminada.')

    await tx.insert(schema.productPrices).values({
      tenantId: input.tenantId,
      productId: product.id,
      priceListId: priceList.id,
      currency: input.price.currency,
      unitPrice: input.price.amount,
    })

    if (input.initialStock && input.initialStock !== 0n) {
      await tx.insert(schema.stockMovements).values({
        tenantId: input.tenantId,
        productId: product.id,
        kind: 'INITIAL',
        quantity: input.initialStock,
        reason: 'Existencia inicial',
        createdByUserId: input.userId,
        occurredAt: now,
      })
    }

    return { productId: product.id }
  })
}

export interface UpdateProductInput {
  readonly tenantId: string
  readonly productId: string
  readonly name?: string | undefined
  readonly barcode?: string | null | undefined
  readonly unit?: string | undefined
  readonly taxRateId?: string | undefined
  readonly priceMode?: PriceMode | undefined
  readonly minStock?: bigint | undefined
  readonly price?: Money | undefined
}

/**
 * Modifica un producto.
 *
 * Cambiar el nombre o el precio NO altera los documentos ya emitidos: cada línea
 * guarda copiada la descripción, el precio y la alícuota del momento en que se
 * imprimió.
 */
export async function updateProduct(db: Database, input: UpdateProductInput): Promise<void> {
  await withTenant(db, input.tenantId, async (tx) => {
    const changes: Record<string, unknown> = {}
    if (input.name !== undefined) changes['name'] = input.name
    if (input.barcode !== undefined) changes['barcode'] = input.barcode
    if (input.unit !== undefined) changes['unit'] = input.unit
    if (input.taxRateId !== undefined) changes['taxRateId'] = input.taxRateId
    if (input.priceMode !== undefined) changes['priceMode'] = input.priceMode
    if (input.minStock !== undefined) changes['minStock'] = input.minStock

    if (Object.keys(changes).length > 0) {
      await tx
        .update(schema.products)
        .set({ ...changes, updatedAt: new Date() })
        .where(eq(schema.products.id, input.productId))
    }

    if (input.price) {
      const lists = await tx
        .select({ id: schema.priceLists.id })
        .from(schema.priceLists)
        .where(and(eq(schema.priceLists.tenantId, input.tenantId), eq(schema.priceLists.isDefault, true)))
        .limit(1)

      const priceList = lists[0]
      if (!priceList) throw new ProductUnavailableError('El negocio no tiene lista de precios predeterminada.')

      await tx
        .insert(schema.productPrices)
        .values({
          tenantId: input.tenantId,
          productId: input.productId,
          priceListId: priceList.id,
          currency: input.price.currency,
          unitPrice: input.price.amount,
        })
        .onConflictDoUpdate({
          target: [schema.productPrices.productId, schema.productPrices.priceListId],
          set: { currency: input.price.currency, unitPrice: input.price.amount, updatedAt: new Date() },
        })
    }
  })
}

/**
 * Retira un producto del catálogo.
 *
 * Es un archivado, no un borrado: el producto tiene que seguir apareciendo en
 * las ventas del año pasado.
 */
export async function archiveProduct(
  db: Database,
  input: { tenantId: string; productId: string; now?: Date | undefined },
): Promise<void> {
  const now = input.now ?? new Date()
  await withTenant(db, input.tenantId, (tx) =>
    tx.update(schema.products).set({ archivedAt: now }).where(eq(schema.products.id, input.productId)),
  )
}

export interface ProductView {
  readonly productId: string
  readonly sku: string
  readonly barcode: string | null
  readonly name: string
  readonly unit: string
  readonly taxCode: string
  readonly priceMode: PriceMode
  readonly price: Money
  readonly tracksStock: boolean
  /** Existencia en milésimas, derivada de los movimientos. */
  readonly stock: bigint
  readonly minStock: bigint
  readonly belowMinimum: boolean
}

/**
 * Busca en el catálogo por nombre, código o código de barras.
 *
 * La existencia se deriva de los movimientos, no se lee de una columna: un saldo
 * guardado y un histórico de movimientos siempre terminan discrepando, y
 * entonces no hay forma de saber cuál miente.
 */
export async function searchProducts(
  db: Database,
  input: {
    tenantId: string
    query?: string | undefined
    limit?: number | undefined
    onlyBelowMinimum?: boolean | undefined
    /** Lista de precios a mostrar. Si el producto no tiene precio en ella, cae a la predeterminada. */
    priceListId?: string | undefined
  },
): Promise<ProductView[]> {
  const pattern = `%${(input.query ?? '').trim()}%`
  const limit = input.limit ?? 50
  const listId = input.priceListId ?? null

  const rows = await withTenant(db, input.tenantId, (tx) =>
    tx.execute<{
      id: string
      sku: string
      barcode: string | null
      name: string
      unit: string
      tax_code: string
      price_mode: PriceMode
      currency: Currency
      unit_price: string | null
      tracks_stock: boolean
      stock: string
      min_stock: string
    }>(sql`
      SELECT p.id, p.sku, p.barcode, p.name, p.unit,
             t.code AS tax_code, p.price_mode,
             COALESCE(sel.currency, pp.currency) AS currency,
             COALESCE(sel.unit_price, pp.unit_price)::text AS unit_price,
             p.tracks_stock, p.min_stock::text AS min_stock,
             COALESCE((SELECT SUM(m.quantity) FROM stock_movements m WHERE m.product_id = p.id), 0)::text AS stock
      FROM products p
      JOIN tax_rates t ON t.id = p.tax_rate_id
      LEFT JOIN price_lists pl ON pl.tenant_id = p.tenant_id AND pl.is_default = true
      LEFT JOIN product_prices pp ON pp.product_id = p.id AND pp.price_list_id = pl.id
      LEFT JOIN product_prices sel ON sel.product_id = p.id
             AND ${listId}::uuid IS NOT NULL AND sel.price_list_id = ${listId}::uuid
      WHERE p.archived_at IS NULL
        AND (${pattern} = '%%' OR p.name ILIKE ${pattern} OR p.sku ILIKE ${pattern} OR p.barcode ILIKE ${pattern})
      ORDER BY p.name
      LIMIT ${limit}
    `),
  )

  const views = [...rows].map((row) => {
    const stock = BigInt(row.stock)
    const minStock = BigInt(row.min_stock)
    return {
      productId: row.id,
      sku: row.sku,
      barcode: row.barcode,
      name: row.name,
      unit: row.unit,
      taxCode: row.tax_code,
      priceMode: row.price_mode,
      price: money(row.currency ?? 'USD', BigInt(row.unit_price ?? '0')),
      tracksStock: row.tracks_stock,
      stock,
      minStock,
      belowMinimum: row.tracks_stock && minStock > 0n && stock <= minStock,
    }
  })

  return input.onlyBelowMinimum ? views.filter((view) => view.belowMinimum) : views
}

/** Productos en o por debajo de su mínimo. Es la alerta de reposición. */
export async function lowStockProducts(db: Database, tenantId: string): Promise<ProductView[]> {
  return searchProducts(db, { tenantId, onlyBelowMinimum: true, limit: 500 })
}

/**
 * Ajusta la existencia de un producto.
 *
 * Toda corrección deja un movimiento con su razón. Sobrescribir un saldo sin
 * rastro es cómo desaparece mercancía sin que nadie pueda reconstruir qué pasó.
 */
export async function adjustStock(
  db: Database,
  input: {
    tenantId: string
    userId: string
    productId: string
    /** Diferencia en milésimas. Negativa para una salida. */
    quantity: bigint
    reason: string
    now?: Date | undefined
  },
): Promise<void> {
  if (input.quantity === 0n) {
    throw new ProductUnavailableError('Un ajuste de cero no tiene efecto.')
  }
  if (input.reason.trim() === '') {
    throw new ProductUnavailableError('Un ajuste de inventario exige una razón.')
  }

  const now = input.now ?? new Date()

  await withTenant(db, input.tenantId, async (tx) => {
    await tx.insert(schema.stockMovements).values({
      tenantId: input.tenantId,
      productId: input.productId,
      kind: 'ADJUSTMENT',
      quantity: input.quantity,
      reason: input.reason,
      createdByUserId: input.userId,
      occurredAt: now,
    })

    await tx.insert(schema.auditLog).values({
      tenantId: input.tenantId,
      actorUserId: input.userId,
      action: 'UPDATE',
      entity: 'stock_movements',
      entityId: input.productId,
      after: { quantity: input.quantity.toString(), reason: input.reason },
      occurredAt: now,
    })
  })
}

/** Existencia de un producto, en milésimas. */
export async function stockOf(db: Database, tenantId: string, productId: string): Promise<bigint> {
  const rows = await withTenant(db, tenantId, (tx) =>
    tx.execute<{ total: string }>(sql`
      SELECT COALESCE(SUM(quantity), 0)::text AS total
      FROM stock_movements WHERE product_id = ${productId}
    `),
  )
  return BigInt([...rows][0]?.total ?? '0')
}

/** Alícuotas configuradas del negocio. */
export async function listTaxRates(db: Database, tenantId: string) {
  return withTenant(db, tenantId, (tx) =>
    tx
      .select()
      .from(schema.taxRates)
      .where(and(eq(schema.taxRates.tenantId, tenantId), isNull(schema.taxRates.archivedAt)))
      .orderBy(schema.taxRates.code),
  )
}

/** Cajas del negocio. El punto de venta necesita saber en cuál está. */
export async function listStations(db: Database, tenantId: string) {
  return withTenant(db, tenantId, (tx) =>
    tx
      .select({ stationId: schema.stations.id, name: schema.stations.name, code: schema.stations.code })
      .from(schema.stations)
      .where(and(eq(schema.stations.tenantId, tenantId), isNull(schema.stations.archivedAt)))
      .orderBy(schema.stations.code),
  )
}

// --- Listas de precios ------------------------------------------------------

export interface PriceListView {
  readonly id: string
  readonly name: string
  readonly isDefault: boolean
}

/**
 * Listas de precios del negocio.
 *
 * Garantiza que exista una lista «Mayor» además de la predeterminada («Detal»):
 * casi todo comercio vende a dos precios. Se crea la primera vez que se consulta,
 * dentro del contexto del negocio, así que no hace falta migrar los negocios ya
 * dados de alta.
 */
export async function listPriceLists(db: Database, tenantId: string): Promise<PriceListView[]> {
  return withTenant(db, tenantId, async (tx) => {
    const traer = () =>
      tx
        .select({ id: schema.priceLists.id, name: schema.priceLists.name, isDefault: schema.priceLists.isDefault })
        .from(schema.priceLists)
        .where(and(eq(schema.priceLists.tenantId, tenantId), isNull(schema.priceLists.archivedAt)))

    let lists = await traer()
    if (!lists.some((l) => l.name === 'Mayor')) {
      await tx.insert(schema.priceLists).values({ tenantId, name: 'Mayor', isDefault: false })
      lists = await traer()
    }

    return [...lists].sort((a, b) => (a.isDefault === b.isDefault ? a.name.localeCompare(b.name) : a.isDefault ? -1 : 1))
  })
}

/** Fija el precio de un producto en una lista. Reemplaza el que hubiera. */
export async function setProductPrice(
  db: Database,
  input: { tenantId: string; productId: string; priceListId: string; price: Money },
): Promise<void> {
  await withTenant(db, input.tenantId, (tx) =>
    tx
      .insert(schema.productPrices)
      .values({
        tenantId: input.tenantId,
        productId: input.productId,
        priceListId: input.priceListId,
        currency: input.price.currency,
        unitPrice: input.price.amount,
      })
      .onConflictDoUpdate({
        target: [schema.productPrices.productId, schema.productPrices.priceListId],
        set: { currency: input.price.currency, unitPrice: input.price.amount, updatedAt: new Date() },
      }),
  )
}
