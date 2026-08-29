/**
 * Tablas alcanzadas por el aislamiento entre negocios.
 *
 * Toda tabla con columna `tenant_id` debe estar en esta lista, y la migración de
 * seguridad por fila la usa para generar sus políticas. Una tabla nueva con
 * `tenant_id` que no aparezca aquí quedaría sin protección — el test
 * `rls.test.ts` compara esta lista contra el esquema real y falla si alguna se
 * quedó fuera.
 *
 * `users` no está: una persona existe por encima de los negocios y puede
 * pertenecer a varios.
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
  'audit_log',
] as const

export type TenantScopedTable = (typeof TENANT_SCOPED_TABLES)[number]
