/**
 * Siembra un negocio de demostración para recorrer la aplicación en vivo.
 *
 *   npm run seed-demo --workspace=@fve/core
 *
 * Lee DATABASE_URL de `packages/db/.env` si no viene en el entorno, VACÍA la base
 * y la vuelve a llenar con un negocio de ejemplo: productos, un proveedor con su
 * compra, un talonario de facturas cargado, y unas ventas —incluida una factura
 * con número de control—. Es solo para desarrollo: no correr contra datos reales.
 *
 * Entrar como negocio:  cajero@demo.ve / clavecajero12
 * Operador:             operador@demo.ve / claveoperador1
 */
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { sql } from 'drizzle-orm'

import { createDatabase, schema } from '@fve/db'
import { hashPassword } from '@fve/auth'
import { usd, ves } from '@fve/money'
import {
  createCustomer,
  createProduct,
  createPurchase,
  createSale,
  createSupplier,
  createTenant,
  createUser,
  fetchRate,
  setControlRange,
  setRate,
  toIsoDate,
  updateIssuer,
} from '../src/index'

// Carga packages/db/.env si DATABASE_URL no viene ya del entorno.
const envPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../db/.env')
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(line)
    if (match?.[1] && process.env[match[1]] === undefined) {
      process.env[match[1]] = (match[2] ?? '').replace(/^["']|["']$/g, '')
    }
  }
}

const url = process.env['DATABASE_URL']
if (!url) throw new Error('Falta DATABASE_URL (en el entorno o en packages/db/.env).')

const { db, close } = createDatabase({ url })
const hoy = toIsoDate(new Date())

try {
  // Base limpia: la demo se siembra desde cero cada vez.
  await db.execute(sql`
    TRUNCATE TABLE
      audit_log, cash_counts, cash_sessions, receivable_entries, receivables,
      expenses, expense_categories, stock_movements, document_payments,
      document_tax_breakdown, document_lines, documents, number_reservations,
      document_series, purchase_payments, purchase_lines, purchases, suppliers, customers,
      product_prices, products, price_lists, tax_rates, exchange_rates,
      station_credentials, sessions, stations, memberships, users, tenants
    RESTART IDENTITY CASCADE
  `)

  const [operador] = await db
    .insert(schema.users)
    .values({
      email: 'operador@demo.ve',
      fullName: 'Operador',
      passwordHash: await hashPassword('claveoperador1'),
      isPlatformAdmin: true,
    })
    .returning({ id: schema.users.id })
  const actorUserId = operador!.id

  const negocio = await createTenant(db, {
    actorUserId,
    name: 'Bodegón La Esquina',
    rifKind: 'J',
    rifNumber: '405512345',
    tradeName: 'Bodegón La Esquina',
  })
  const tenantId = negocio.tenantId

  const { userId } = await createUser(db, {
    actorUserId,
    email: 'cajero@demo.ve',
    fullName: 'María González',
    password: 'clavecajero12',
    tenantId,
  })

  await updateIssuer(db, {
    tenantId,
    legalName: 'Inversiones La Esquina, C.A.',
    address: 'Av. Bolívar, local 3',
    city: 'Maracay, Aragua',
    phone: '0243-555-1234',
    email: 'ventas@laesquina.ve',
    documentFooter: 'Gracias por su compra. No se aceptan devoluciones sin este documento.',
  })

  // Tasa real del BCV (vía dolarapi) para hoy; si no hay internet, un valor por defecto.
  let tasaValor = '84,00'
  let tasaFecha = hoy
  try {
    const cotizacion = await fetchRate()
    tasaValor = cotizacion.value
    tasaFecha = cotizacion.effectiveOn
    console.log(`  Tasa del BCV (dolarapi): Bs ${tasaValor} · ${tasaFecha}`)
  } catch {
    console.log('  Sin internet: se usa una tasa de ejemplo (Bs 84,00).')
  }
  await setRate(db, { tenantId, value: tasaValor, effectiveOn: tasaFecha, userId: actorUserId })

  const g = negocio.taxRateIds['G']!
  const e = negocio.taxRateIds['E']!

  const harina = await createProduct(db, { tenantId, userId, sku: 'HAR-001', name: 'Harina de maíz P.A.N. 1kg', taxRateId: g, price: usd(100n) })
  const aceite = await createProduct(db, { tenantId, userId, sku: 'ACE-500', name: 'Aceite de girasol Vatel 1L', taxRateId: g, price: usd(250n) })
  const cafe = await createProduct(db, { tenantId, userId, sku: 'CAF-250', name: 'Café Fama de América 250g', taxRateId: g, price: usd(200n) })
  const pan = await createProduct(db, { tenantId, userId, sku: 'PAN-001', name: 'Pan canilla', taxRateId: e, price: usd(50n) })

  const { supplierId } = await createSupplier(db, {
    tenantId,
    idKind: 'J',
    idNumber: '412209876',
    name: 'Distribuidora Central, C.A.',
    contactName: 'Pedro Ramírez',
    phone: '0412-999-8877',
  })
  await createPurchase(db, {
    tenantId,
    userId,
    supplierId,
    invoiceNumber: 'A-004521',
    controlNumber: '01-00098765',
    currency: 'USD',
    iva: usd(1200n),
    lines: [
      { productId: harina.productId, description: 'Harina de maíz P.A.N. 1kg', quantity: 100000n, unitCost: usd(70n) },
      { productId: aceite.productId, description: 'Aceite de girasol Vatel 1L', quantity: 40000n, unitCost: usd(180n) },
      { productId: cafe.productId, description: 'Café Fama de América 250g', quantity: 30000n, unitCost: usd(150n) },
    ],
  })

  await setControlRange(db, { tenantId, kind: 'FACTURA', prefix: '00-', from: 21547, to: 21600 })

  const cliente = await createCustomer(db, {
    tenantId,
    idKind: 'J',
    idNumber: '412209999',
    name: 'Ferretería El Tornillo, C.A.',
    phone: '0412-111-2222',
    address: 'Calle 5, Zona Industrial San Vicente',
  })

  // Una FACTURA con cliente (obtiene número de control).
  await createSale(db, {
    tenantId,
    stationId: negocio.stationId,
    userId,
    kind: 'FACTURA',
    currency: 'USD',
    customerId: cliente.customerId,
    lines: [
      { productId: harina.productId, quantity: 10000n },
      { productId: aceite.productId, quantity: 3000n },
    ],
    payments: [{ method: 'EFECTIVO_BS', amount: ves(2000000n) }],
  })

  // Un par de notas de entrega de contado, para dar volumen al reporte.
  await createSale(db, {
    tenantId,
    stationId: negocio.stationId,
    userId,
    currency: 'USD',
    lines: [{ productId: cafe.productId, quantity: 2000n }, { productId: pan.productId, quantity: 5000n }],
    payments: [{ method: 'EFECTIVO_BS', amount: ves(2000000n) }],
  })
  await createSale(db, {
    tenantId,
    stationId: negocio.stationId,
    userId,
    currency: 'USD',
    lines: [{ productId: harina.productId, quantity: 4000n }],
    payments: [{ method: 'EFECTIVO_BS', amount: ves(2000000n) }],
  })

  console.log('Sembrado OK.')
  console.log('  Entrar como negocio:  cajero@demo.ve / clavecajero12')
  console.log('  Operador:             operador@demo.ve / claveoperador1')
} finally {
  await close()
}
