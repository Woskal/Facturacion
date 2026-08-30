/**
 * Tablas alcanzadas por el aislamiento entre negocios.
 *
 * Toda tabla con columna `tenant_id` debe estar en esta lista, y la migración de
 * seguridad por fila la usa para generar sus políticas. Una tabla nueva con
 * `tenant_id` que no aparezca aquí quedaría sin protección — el test de
 * cobertura compara esta lista contra el esquema real y falla si alguna se
 * quedó fuera.
 */
export const TENANT_SCOPED_TABLES = [
  'memberships',
  'stations',
  'exchange_rates',
  'tax_rates',
  'price_lists',
  'products',
  'product_prices',
  'customers',
  'document_series',
  'number_reservations',
  'documents',
  'document_lines',
  'document_tax_breakdown',
  'document_payments',
  'stock_movements',
  'expense_categories',
  'expenses',
  'receivables',
  'receivable_entries',
  'cash_sessions',
  'cash_counts',
  'station_credentials',
  'subscriptions',
  'subscription_payments',
  'audit_log',
] as const

export type TenantScopedTable = (typeof TENANT_SCOPED_TABLES)[number]

/**
 * Tablas de plataforma: existen por encima de los negocios y por eso NO están
 * bajo aislamiento. Cada una necesita justificación, porque cada una es un sitio
 * donde el aislamiento no protege.
 *
 * - `tenants`  — es la raíz misma; no puede pertenecerse a sí misma.
 * - `users`    — una persona vive por encima de los negocios y puede pertenecer
 *                a varios con una sola cuenta.
 * - `sessions` — el login ocurre antes de que exista contexto de negocio, y una
 *                sesión pertenece a la persona, no al negocio. Su columna se
 *                llama `active_tenant_id` precisamente porque no es un dueño
 *                sino una selección vigente.
 *
 * Nada más debe entrar aquí sin una razón igual de concreta.
 */
export const PLATFORM_TABLES = ['tenants', 'users', 'sessions'] as const

export type PlatformTable = (typeof PLATFORM_TABLES)[number]
