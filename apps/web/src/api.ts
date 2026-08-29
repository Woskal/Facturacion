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
