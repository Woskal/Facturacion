import { sql } from 'drizzle-orm'
import { schema, withTenant, type Database } from '@fve/db'
import { money, type Currency, type Money } from '@fve/money'

import type { IsoDate } from './rates'

/**
 * Reportes.
 *
 * Todos leen de lo que quedó PERSISTIDO en el documento —su desglose por
 * alícuota y su tasa— y nunca recalculan nada. Un libro que se recalcula con el
 * código de hoy o con las alícuotas de hoy da un número distinto al que se
 * imprimió y al que se declaró, y entonces no es un libro: es una opinión.
 */

export interface SalesBookRow {
  readonly date: string
  readonly fullNumber: string
  readonly controlNumber: string | null
  readonly customerId: string | null
  readonly customerName: string
  readonly voided: boolean
  /** Todos los importes en bolívares, que es como se lleva el libro. */
  readonly total: Money
  readonly exempt: Money
  readonly baseGeneral: Money
  readonly ivaGeneral: Money
  readonly baseReducida: Money
  readonly ivaReducida: Money
  readonly baseSuntuaria: Money
  readonly ivaSuntuaria: Money
  readonly igtf: Money
}

export interface SalesBook {
  readonly from: IsoDate
  readonly to: IsoDate
  readonly rows: readonly SalesBookRow[]
  readonly totals: Omit<SalesBookRow, 'date' | 'fullNumber' | 'controlNumber' | 'customerId' | 'customerName' | 'voided'>
}

/**
 * Libro de ventas del período.
 *
 * Incluye los documentos ANULADOS con importes en cero. No es un descuido: el
 * libro tiene que justificar cada número de la serie, y un salto sin explicación
 * es lo primero que pregunta una fiscalización.
 */
export async function salesBook(
  db: Database,
  input: { tenantId: string; from: IsoDate; to: IsoDate },
): Promise<SalesBook> {
  const rows = await withTenant(db, input.tenantId, (tx) =>
    tx.execute<{
      fecha: string
      full_number: string
      control_number: string | null
      customer_id: string | null
      cliente: string
      anulado: boolean
      total: string
      exento: string
      base_g: string
      iva_g: string
      base_r: string
      iva_r: string
      base_s: string
      iva_s: string
      igtf: string
    }>(sql`
      SELECT
        to_char(d.issued_at AT TIME ZONE 'America/Caracas', 'YYYY-MM-DD') AS fecha,
        d.full_number,
        d.control_number,
        d.customer_id,
        COALESCE(c.id_kind || '-' || c.id_number || ' ' || c.name, 'Consumidor final') AS cliente,
        (d.status = 'VOIDED') AS anulado,
        CASE WHEN d.status = 'VOIDED' THEN 0 ELSE d.grand_total_ves END::text AS total,
        CASE WHEN d.status = 'VOIDED' THEN 0 ELSE d.exempt_base_ves END::text AS exento,
        CASE WHEN d.status = 'VOIDED' THEN 0 ELSE d.igtf_ves END::text AS igtf,
        COALESCE(SUM(b.base_ves)      FILTER (WHERE b.tax_code = 'G' AND d.status <> 'VOIDED'), 0)::text AS base_g,
        COALESCE(SUM(b.iva_base_ves)  FILTER (WHERE b.tax_code = 'G' AND d.status <> 'VOIDED'), 0)::text AS iva_g,
        COALESCE(SUM(b.base_ves)      FILTER (WHERE b.tax_code = 'R' AND d.status <> 'VOIDED'), 0)::text AS base_r,
        COALESCE(SUM(b.iva_base_ves)  FILTER (WHERE b.tax_code = 'R' AND d.status <> 'VOIDED'), 0)::text AS iva_r,
        COALESCE(SUM(b.base_ves)      FILTER (WHERE b.tax_code = 'S' AND d.status <> 'VOIDED'), 0)::text AS base_s,
        COALESCE(SUM(b.iva_base_ves + b.iva_adicional_ves)
                                      FILTER (WHERE b.tax_code = 'S' AND d.status <> 'VOIDED'), 0)::text AS iva_s
      FROM documents d
      LEFT JOIN customers c ON c.id = d.customer_id
      LEFT JOIN document_tax_breakdown b ON b.document_id = d.id
      WHERE d.status IN ('ISSUED', 'VOIDED')
        AND d.issued_at IS NOT NULL
        AND (d.issued_at AT TIME ZONE 'America/Caracas')::date BETWEEN ${input.from}::date AND ${input.to}::date
      GROUP BY d.id, c.id_kind, c.id_number, c.name
      ORDER BY d.issued_at, d.number
    `),
  )

  const bs = (valor: string) => money('VES', BigInt(valor))

  const filas: SalesBookRow[] = [...rows].map((row) => ({
    date: row.fecha,
    fullNumber: row.full_number,
    controlNumber: row.control_number,
    customerId: row.customer_id,
    customerName: row.cliente,
    voided: row.anulado,
    total: bs(row.total),
    exempt: bs(row.exento),
    baseGeneral: bs(row.base_g),
    ivaGeneral: bs(row.iva_g),
    baseReducida: bs(row.base_r),
    ivaReducida: bs(row.iva_r),
    baseSuntuaria: bs(row.base_s),
    ivaSuntuaria: bs(row.iva_s),
    igtf: bs(row.igtf),
  }))

  const sumar = (extraer: (fila: SalesBookRow) => Money) =>
    money('VES', filas.reduce((acumulado, fila) => acumulado + extraer(fila).amount, 0n))

  return {
    from: input.from,
    to: input.to,
    rows: filas,
    totals: {
      total: sumar((f) => f.total),
      exempt: sumar((f) => f.exempt),
      baseGeneral: sumar((f) => f.baseGeneral),
      ivaGeneral: sumar((f) => f.ivaGeneral),
      baseReducida: sumar((f) => f.baseReducida),
      ivaReducida: sumar((f) => f.ivaReducida),
      baseSuntuaria: sumar((f) => f.baseSuntuaria),
      ivaSuntuaria: sumar((f) => f.ivaSuntuaria),
      igtf: sumar((f) => f.igtf),
    },
  }
}

export interface DailySales {
  readonly date: string
  readonly documents: number
  readonly totalVes: Money
  readonly totalUsd: Money
}

/**
 * Ventas por día.
 *
 * Se agrupa por la fecha de Caracas, no por UTC: una venta de las nueve de la
 * noche pertenece a ese día para quien la hizo, no al siguiente.
 */
export async function dailySales(
  db: Database,
  input: { tenantId: string; from: IsoDate; to: IsoDate },
): Promise<DailySales[]> {
  const rows = await withTenant(db, input.tenantId, (tx) =>
    tx.execute<{ fecha: string; documentos: string; total_ves: string; total_usd: string }>(sql`
      SELECT
        to_char(d.issued_at AT TIME ZONE 'America/Caracas', 'YYYY-MM-DD') AS fecha,
        COUNT(*)::text AS documentos,
        COALESCE(SUM(d.grand_total_ves), 0)::text AS total_ves,
        COALESCE(SUM(d.grand_total_usd), 0)::text AS total_usd
      FROM documents d
      WHERE d.status = 'ISSUED'
        AND d.issued_at IS NOT NULL
        AND (d.issued_at AT TIME ZONE 'America/Caracas')::date BETWEEN ${input.from}::date AND ${input.to}::date
      GROUP BY 1
      ORDER BY 1
    `),
  )

  return [...rows].map((row) => ({
    date: row.fecha,
    documents: Number(row.documentos),
    totalVes: money('VES', BigInt(row.total_ves)),
    totalUsd: money('USD', BigInt(row.total_usd)),
  }))
}

export interface MethodSales {
  readonly method: string
  readonly currency: Currency
  readonly received: Money
  readonly count: number
}

/**
 * Cobrado por medio de pago.
 *
 * Al efectivo se le resta el vuelto entregado, igual que en el arqueo de caja.
 * Sumar lo que el cliente puso sobre el mostrador sin descontar lo que se le
 * devolvió no es «cobrado»: es un número que contradice el conteo de la gaveta.
 *
 * Los medios que no son efectivo no llevan vuelto — lo que salió del banco del
 * cliente entró completo— así que se dejan tal cual.
 */
export async function salesByMethod(
  db: Database,
  input: { tenantId: string; from: IsoDate; to: IsoDate },
): Promise<MethodSales[]> {
  const rows = await withTenant(db, input.tenantId, (tx) =>
    tx.execute<{ method: string; currency: Currency; total: string; veces: string }>(sql`
      WITH cobrado AS (
        SELECT p.method::text AS method, p.currency::text AS currency,
               SUM(p.amount) AS total, COUNT(*) AS veces
        FROM document_payments p
        JOIN documents d ON d.id = p.document_id
        WHERE d.status = 'ISSUED'
          AND d.issued_at IS NOT NULL
          AND (d.issued_at AT TIME ZONE 'America/Caracas')::date BETWEEN ${input.from}::date AND ${input.to}::date
        GROUP BY 1, 2
      ),
      vuelto AS (
        SELECT CASE WHEN d.change_currency = 'USD' THEN 'EFECTIVO_USD' ELSE 'EFECTIVO_BS' END AS method,
               d.change_currency::text AS currency,
               SUM(d.change_amount) AS total
        FROM documents d
        WHERE d.status = 'ISSUED'
          AND d.change_amount > 0
          AND d.change_currency IS NOT NULL
          AND d.issued_at IS NOT NULL
          AND (d.issued_at AT TIME ZONE 'America/Caracas')::date BETWEEN ${input.from}::date AND ${input.to}::date
        GROUP BY 1, 2
      )
      SELECT c.method, c.currency,
             (c.total - COALESCE(v.total, 0))::text AS total,
             c.veces::text AS veces
      FROM cobrado c
      LEFT JOIN vuelto v ON v.method = c.method AND v.currency = c.currency
      ORDER BY 1, 2
    `),
  )

  return [...rows].map((row) => ({
    method: row.method,
    currency: row.currency,
    received: money(row.currency, BigInt(row.total)),
    count: Number(row.veces),
  }))
}

export interface TopProduct {
  readonly productId: string | null
  readonly sku: string | null
  readonly name: string
  /** Cantidad vendida en milésimas. */
  readonly quantity: bigint
  readonly totalVes: Money
}

/** Lo más vendido del período, por importe. */
export async function topProducts(
  db: Database,
  input: { tenantId: string; from: IsoDate; to: IsoDate; limit?: number | undefined },
): Promise<TopProduct[]> {
  const rows = await withTenant(db, input.tenantId, (tx) =>
    tx.execute<{
      product_id: string | null
      sku: string | null
      description: string
      cantidad: string
      total: string
    }>(sql`
      SELECT l.product_id, MAX(l.sku) AS sku, MAX(l.description) AS description,
             COALESCE(SUM(l.quantity), 0)::text AS cantidad,
             -- La línea está en la moneda del documento; se lleva a bolívares
             -- con la tasa que ese documento guardó, no con la de hoy.
             COALESCE(SUM(
               CASE WHEN d.currency = 'VES' THEN l.total
                    ELSE (l.total * d.rate_bs_per_usd) / 100000000
               END
             ), 0)::text AS total
      FROM document_lines l
      JOIN documents d ON d.id = l.document_id
      WHERE d.status = 'ISSUED'
        AND d.issued_at IS NOT NULL
        AND (d.issued_at AT TIME ZONE 'America/Caracas')::date BETWEEN ${input.from}::date AND ${input.to}::date
      GROUP BY l.product_id
      ORDER BY SUM(
        CASE WHEN d.currency = 'VES' THEN l.total
             ELSE (l.total * d.rate_bs_per_usd) / 100000000
        END
      ) DESC
      LIMIT ${input.limit ?? 20}
    `),
  )

  return [...rows].map((row) => ({
    productId: row.product_id,
    sku: row.sku,
    name: row.description,
    quantity: BigInt(row.cantidad),
    totalVes: money('VES', BigInt(row.total)),
  }))
}

/**
 * Libro de ventas en CSV, listo para abrir en una hoja de cálculo.
 *
 * Se usa punto y coma como separador y coma decimal, que es lo que espera Excel
 * configurado en español. Con coma de separador, cada importe se partiría en dos
 * columnas.
 */
export function salesBookToCsv(book: SalesBook): string {
  const bs = (valor: Money) => {
    const negativo = valor.amount < 0n
    const magnitud = negativo ? -valor.amount : valor.amount
    return `${negativo ? '-' : ''}${magnitud / 100n},${(magnitud % 100n).toString().padStart(2, '0')}`
  }

  const cabecera = [
    'Fecha',
    'Documento',
    'Número de control',
    'Cliente',
    'Estado',
    'Total',
    'Exento',
    'Base 16%',
    'IVA 16%',
    'Base 8%',
    'IVA 8%',
    'Base suntuaria',
    'IVA suntuario',
    'IGTF',
  ]

  const escapar = (texto: string) => `"${texto.replace(/"/g, '""')}"`

  const lineas = book.rows.map((fila) =>
    [
      fila.date,
      escapar(fila.fullNumber),
      escapar(fila.controlNumber ?? ''),
      escapar(fila.customerName),
      fila.voided ? 'ANULADO' : 'EMITIDO',
      bs(fila.total),
      bs(fila.exempt),
      bs(fila.baseGeneral),
      bs(fila.ivaGeneral),
      bs(fila.baseReducida),
      bs(fila.ivaReducida),
      bs(fila.baseSuntuaria),
      bs(fila.ivaSuntuaria),
      bs(fila.igtf),
    ].join(';'),
  )

  const totales = [
    '',
    escapar('TOTALES'),
    '',
    '',
    '',
    bs(book.totals.total),
    bs(book.totals.exempt),
    bs(book.totals.baseGeneral),
    bs(book.totals.ivaGeneral),
    bs(book.totals.baseReducida),
    bs(book.totals.ivaReducida),
    bs(book.totals.baseSuntuaria),
    bs(book.totals.ivaSuntuaria),
    bs(book.totals.igtf),
  ].join(';')

  return [cabecera.join(';'), ...lineas, totales].join('\r\n')
}
