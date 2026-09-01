import { money, type Currency, type Money } from '@fve/money'

/**
 * Cliente de la API.
 *
 * Los montos llegan como texto en unidades menores y se reconstruyen con
 * `@fve/money`, el mismo paquete que usa el servidor. En ningún punto un importe
 * pasa por un `number`, que en JavaScript es un float.
 */

export interface MoneyJson {
  readonly currency: Currency
  readonly amount: string
}

export function toMoney(value: MoneyJson): Money {
  return money(value.currency, BigInt(value.amount))
}

export function fromMoney(value: Money): MoneyJson {
  return { currency: value.currency, amount: value.amount.toString() }
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: { path: string; message: string }[],
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

const BASE = '/api'

let token: string | null = localStorage.getItem('fve.token')

export function getToken(): string | null {
  return token
}

export function setToken(value: string | null): void {
  token = value
  if (value) localStorage.setItem('fve.token', value)
  else localStorage.removeItem('fve.token')
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })

  if (response.status === 204) return undefined as T

  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new ApiError(response.status, payload.error ?? 'Error inesperado.', payload.details)
  }

  return payload as T
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
}

// --- Tipos de la API --------------------------------------------------------

export interface Membership {
  tenantId: string
  tenantName: string
  role: string
}

export interface LoginResponse {
  token: string
  expiresAt: string
  user: { id: string; fullName: string; isPlatformAdmin: boolean }
  memberships: Membership[]
}

export interface RateJson {
  bsPerUsd: string
  date: string
  source: string
  id: string
}

export interface ProductJson {
  productId: string
  sku: string
  barcode: string | null
  name: string
  unit: string
  taxCode: string
  priceMode: 'IVA_INCLUIDO' | 'IVA_EXCLUIDO'
  price: MoneyJson
  tracksStock: boolean
  stock: string
  minStock: string
  belowMinimum: boolean
}

export interface TaxRateJson {
  id: string
  code: string
  name: string
  baseBps: number
  adicionalBps: number
  isDefault: boolean
}

export interface CustomerJson {
  customerId: string
  id: string
  name: string
  phone: string | null
  specialTaxpayer: boolean
  openReceivables: number
}

export interface SaleResponse {
  documentId: string
  fullNumber: string
  number: number
  currency: Currency
  deduplicated: boolean
  totals: {
    gross: MoneyJson
    discount: MoneyJson
    base: MoneyJson
    exempt: MoneyJson
    ivaBase: MoneyJson
    ivaAdicional: MoneyJson
    ivaTotal: MoneyJson
    total: MoneyJson
  }
  settlement: {
    totalDue: MoneyJson
    igtf: MoneyJson
    change: MoneyJson
    changeCurrency: Currency
    credit: MoneyJson
  }
  rate: { bsPerUsd: string; date: string }
}

export type DocumentKind = 'FACTURA' | 'PRESUPUESTO' | 'NOTA_ENTREGA' | 'RECIBO' | 'NOTA_CREDITO'

export interface CustomerHistoryJson {
  documentId: string
  fullNumber: string
  kind: DocumentKind
  status: 'DRAFT' | 'ISSUED' | 'VOIDED'
  issuedAt: string | null
  currency: Currency
  totalUsd: string
  totalVes: string
}

export interface DocumentSummaryJson {
  documentId: string
  kind: DocumentKind
  fullNumber: string
  controlNumber: string | null
  status: 'DRAFT' | 'ISSUED' | 'VOIDED'
  issuedAt: string | null
  customerName: string
  currency: Currency
  totalVes: MoneyJson
  totalUsd: MoneyJson
}

export interface IssuerJson {
  name: string
  legalName: string | null
  rif: string
  rifKind: string
  address: string | null
  city: string | null
  phone: string | null
  email: string | null
  website: string | null
  footer: string | null
}

export interface ControlBookJson {
  seriesId: string
  kind: DocumentKind
  prefix: string | null
  next: number | null
  last: number | null
  remaining: number
}

export interface FullDocumentJson {
  documentId: string
  kind: DocumentKind
  fullNumber: string
  controlNumber: string | null
  status: 'DRAFT' | 'ISSUED' | 'VOIDED'
  issuedAt: string | null
  voidReason: string | null
  currency: Currency
  rateBsPerUsd: string
  rateDate: string
  issuer: {
    name: string
    legalName: string | null
    rif: string
    address: string | null
    city: string | null
    phone: string | null
    email: string | null
    website: string | null
    footer: string | null
  }
  customer: { name: string; id: string; address: string | null; phone: string | null } | null
  lines: {
    lineNumber: number
    sku: string | null
    description: string
    unit: string
    quantity: string
    unitPrice: MoneyJson
    discountBps: number
    taxCode: string
    total: MoneyJson
  }[]
  taxes: { taxCode: string; baseBps: number; adicionalBps: number; base: MoneyJson; iva: MoneyJson }[]
  payments: { method: string; amount: MoneyJson; reference: string | null }[]
  totals: {
    gross: MoneyJson
    discount: MoneyJson
    taxableBase: MoneyJson
    exempt: MoneyJson
    iva: MoneyJson
    igtf: MoneyJson
    total: MoneyJson
    grandTotal: MoneyJson
  }
  totalOther: MoneyJson
  notes: string | null
  issuedBy: string
}

export interface RetentionRowJson {
  occurredAt: string
  kind: 'RETENTION_IVA' | 'RETENTION_ISLR'
  retentionNumber: string | null
  customerName: string
  fullNumber: string
  amount: MoneyJson
}

export interface ProfitRowJson {
  productId: string | null
  sku: string | null
  name: string
  quantity: string
  revenue: MoneyJson
  cost: MoneyJson
  profit: MoneyJson
  hasCost: boolean
}

export interface ProfitReportJson {
  from: string
  to: string
  rows: ProfitRowJson[]
  totals: { revenue: MoneyJson; cost: MoneyJson; profit: MoneyJson }
  marginBps: number
}

export interface SupplierJson {
  supplierId: string
  id: string
  name: string
  contactName: string | null
  phone: string | null
  email: string | null
  purchaseCount: number
}

export interface PurchaseSummaryJson {
  purchaseId: string
  supplierName: string
  invoiceNumber: string
  controlNumber: string | null
  occurredAt: string
  currency: Currency
  totalVes: MoneyJson
  totalUsd: MoneyJson
}

export interface PayableJson {
  purchaseId: string
  supplierId: string
  supplierName: string
  invoiceNumber: string
  currency: Currency
  total: MoneyJson
  paid: MoneyJson
  balance: MoneyJson
  settled: boolean
}

export interface FullPurchaseJson {
  purchaseId: string
  supplier: { name: string; id: string; phone: string | null }
  invoiceNumber: string
  controlNumber: string | null
  currency: Currency
  occurredAt: string
  net: MoneyJson
  iva: MoneyJson
  total: MoneyJson
  paid: MoneyJson
  balance: MoneyJson
  notes: string | null
  lines: { description: string; sku: string | null; quantity: string; unitCost: MoneyJson; lineTotal: MoneyJson }[]
  payments: { method: string | null; amount: MoneyJson; reference: string | null; occurredAt: string }[]
}

export interface ExpenseJson {
  expenseId: string
  category: string | null
  description: string
  currency: Currency
  amount: MoneyJson
  amountVes: MoneyJson
  paidWith: string | null
  occurredAt: string
}

export interface CashLineJson {
  method: string
  currency: Currency
  opening: MoneyJson
  expected: MoneyJson
  counted: MoneyJson
  difference: MoneyJson
}

export interface CashSessionJson {
  sessionId: string
  openedAt: string
  closedAt: string | null
  documentCount: number
  lines: CashLineJson[]
}
