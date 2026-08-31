import { and, eq, sql } from 'drizzle-orm'
import { schema, withTenant, type Database } from '@fve/db'
import { money, type Currency, type Money } from '@fve/money'

import { DocumentNotFoundError } from './errors'
import type { DocumentKind } from './sales'
import type { IsoDate } from './rates'

/**
 * Lectura de documentos emitidos.
 *
 * Es lo que hace falta para VER e IMPRIMIR una factura, que es la razón de ser
 * de un sistema de facturación. Todo sale de lo que quedó guardado con el
 * documento —descripción, precio, alícuota, tasa y los datos de la empresa— y
 * nada se recalcula: una factura reimpresa el año que viene tiene que salir
 * idéntica a la que se le entregó al cliente.
 */

export interface DocumentIssuer {
  readonly name: string
  readonly legalName: string | null
  readonly rif: string
  readonly address: string | null
  readonly city: string | null
  readonly phone: string | null
  readonly email: string | null
  readonly website: string | null
  readonly footer: string | null
}

export interface DocumentParty {
  readonly name: string
  readonly id: string
  readonly address: string | null
  readonly phone: string | null
}

export interface DocumentLine {
  readonly lineNumber: number
  readonly sku: string | null
  readonly description: string
  readonly unit: string
  /** Cantidad en milésimas. */
  readonly quantity: bigint
  readonly unitPrice: Money
  readonly discountBps: number
  readonly taxCode: string
  readonly total: Money
}

export interface DocumentTaxLine {
  readonly taxCode: string
  readonly baseBps: number
  readonly adicionalBps: number
  readonly base: Money
  readonly iva: Money
}

export interface DocumentPayment {
  readonly method: string
  readonly amount: Money
  readonly reference: string | null
}

export interface FullDocument {
  readonly documentId: string
  readonly kind: DocumentKind
  readonly fullNumber: string
  readonly controlNumber: string | null
  readonly status: 'DRAFT' | 'ISSUED' | 'VOIDED'
  readonly issuedAt: Date | null
  readonly voidReason: string | null
  readonly currency: Currency
  /** Tasa con que se emitió. Va impresa: es lo que explica los dos importes. */
  readonly rateBsPerUsd: bigint
  readonly rateDate: IsoDate
  readonly issuer: DocumentIssuer
  readonly customer: DocumentParty | null
  readonly lines: readonly DocumentLine[]
  readonly taxes: readonly DocumentTaxLine[]
  readonly payments: readonly DocumentPayment[]
  readonly totals: {
    readonly gross: Money
    readonly discount: Money
    readonly taxableBase: Money
    readonly exempt: Money
    readonly iva: Money
    readonly igtf: Money
    readonly total: Money
    readonly grandTotal: Money
  }
  /** El mismo total en la otra moneda, para imprimir el par. */
  readonly totalOther: Money
  readonly notes: string | null
  readonly issuedBy: string
}

/** Un documento completo, listo para mostrarse o imprimirse. */
export async function getDocument(
  db: Database,
  input: { tenantId: string; documentId: string },
): Promise<FullDocument> {
  return withTenant(db, input.tenantId, async (tx) => {
    const filas = await tx
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, input.documentId))
      .limit(1)

    const doc = filas[0]
    if (!doc) throw new DocumentNotFoundError(input.documentId)

    const [negocio] = await tx.select().from(schema.tenants).where(eq(schema.tenants.id, input.tenantId)).limit(1)
    if (!negocio) throw new DocumentNotFoundError(input.documentId)

    const [emisor] = await tx
      .select({ fullName: schema.users.fullName })
      .from(schema.users)
      .where(eq(schema.users.id, doc.issuedByUserId))
      .limit(1)

    const cliente = doc.customerId
      ? (
          await tx.select().from(schema.customers).where(eq(schema.customers.id, doc.customerId)).limit(1)
        )[0]
      : undefined

    const lineas = await tx
      .select()
      .from(schema.documentLines)
      .where(eq(schema.documentLines.documentId, doc.id))
      .orderBy(schema.documentLines.lineNumber)

    const impuestos = await tx
      .select()
      .from(schema.documentTaxBreakdown)
      .where(eq(schema.documentTaxBreakdown.documentId, doc.id))
      .orderBy(schema.documentTaxBreakdown.taxCode)

    const pagos = await tx
      .select()
      .from(schema.documentPayments)
      .where(eq(schema.documentPayments.documentId, doc.id))

    const moneda = doc.currency
    const propia = (usd: bigint, ves: bigint) => money(moneda, moneda === 'USD' ? usd : ves)
    const otra = (usd: bigint, ves: bigint) =>
      moneda === 'USD' ? money('VES', ves) : money('USD', usd)

    return {
      documentId: doc.id,
      kind: doc.kind,
      fullNumber: doc.fullNumber,
      controlNumber: doc.controlNumber,
      status: doc.status,
      issuedAt: doc.issuedAt,
      voidReason: doc.voidReason,
      currency: moneda,
      rateBsPerUsd: doc.rateBsPerUsd,
      rateDate: doc.rateEffectiveOn,
      issuer: {
        name: negocio.tradeName ?? negocio.name,
        legalName: negocio.legalName ?? negocio.name,
        rif: `${negocio.rifKind}-${negocio.rifNumber}`,
        address: negocio.address,
        city: negocio.city,
        phone: negocio.phone,
        email: negocio.email,
        website: negocio.website,
        footer: negocio.documentFooter,
      },
      customer: cliente
        ? {
            name: cliente.name,
            id: `${cliente.idKind}-${cliente.idNumber}`,
            address: cliente.address,
            phone: cliente.phone,
          }
        : null,
      lines: lineas.map((linea) => ({
        lineNumber: linea.lineNumber,
        sku: linea.sku,
        description: linea.description,
        unit: linea.unit,
        quantity: linea.quantity,
        unitPrice: money(moneda, linea.unitPrice),
        discountBps: linea.discountBps,
        taxCode: linea.taxCode,
        total: money(moneda, linea.total),
      })),
      taxes: impuestos.map((fila) => ({
        taxCode: fila.taxCode,
        baseBps: fila.baseBps,
        adicionalBps: fila.adicionalBps,
        base: propia(fila.baseUsd, fila.baseVes),
        iva: propia(fila.ivaBaseUsd + fila.ivaAdicionalUsd, fila.ivaBaseVes + fila.ivaAdicionalVes),
      })),
      payments: pagos.map((pago) => ({
        method: pago.method,
        amount: money(pago.currency, pago.amount),
        reference: pago.reference,
      })),
      totals: {
        gross: propia(doc.grossUsd, doc.grossVes),
        discount: propia(doc.discountUsd, doc.discountVes),
        taxableBase: propia(doc.taxableBaseUsd, doc.taxableBaseVes),
        exempt: propia(doc.exemptBaseUsd, doc.exemptBaseVes),
        iva: propia(doc.ivaBaseUsd + doc.ivaAdicionalUsd, doc.ivaBaseVes + doc.ivaAdicionalVes),
        igtf: propia(doc.igtfUsd, doc.igtfVes),
        total: propia(doc.totalUsd, doc.totalVes),
        grandTotal: propia(doc.grandTotalUsd, doc.grandTotalVes),
      },
      totalOther: otra(doc.grandTotalUsd, doc.grandTotalVes),
      notes: doc.notes,
      issuedBy: emisor?.fullName ?? '',
    }
  })
}

export interface DocumentSummary {
  readonly documentId: string
  readonly kind: DocumentKind
  readonly fullNumber: string
  readonly controlNumber: string | null
  readonly status: 'DRAFT' | 'ISSUED' | 'VOIDED'
  readonly issuedAt: Date | null
  readonly customerName: string
  readonly currency: Currency
  readonly totalVes: Money
  readonly totalUsd: Money
}

export interface SearchDocumentsInput {
  readonly tenantId: string
  /** Busca en número, número de control y nombre del cliente. */
  readonly query?: string | undefined
  readonly kind?: DocumentKind | undefined
  readonly status?: 'ISSUED' | 'VOIDED' | undefined
  readonly from?: IsoDate | undefined
  readonly to?: IsoDate | undefined
  readonly customerId?: string | undefined
  readonly limit?: number | undefined
}

/**
 * Busca entre lo emitido.
 *
 * Es la pantalla que uno abre cuando un cliente llama diciendo «necesito una
 * copia de la factura de la semana pasada». Busca por número, por número de
 * control y por nombre del cliente a la vez, porque quien llama puede tener
 * cualquiera de los tres a mano y ninguno de los otros dos.
 */
export async function searchDocuments(
  db: Database,
  input: SearchDocumentsInput,
): Promise<DocumentSummary[]> {
  const patron = `%${(input.query ?? '').trim()}%`
  const limite = input.limit ?? 100

  const filas = await withTenant(db, input.tenantId, (tx) =>
    tx.execute<{
      id: string
      kind: DocumentKind
      full_number: string
      control_number: string | null
      status: 'DRAFT' | 'ISSUED' | 'VOIDED'
      issued_at: string | null
      cliente: string
      currency: Currency
      total_ves: string
      total_usd: string
    }>(sql`
      SELECT d.id, d.kind, d.full_number, d.control_number, d.status, d.issued_at,
             COALESCE(c.name, 'Consumidor final') AS cliente,
             d.currency, d.grand_total_ves::text AS total_ves, d.grand_total_usd::text AS total_usd
      FROM documents d
      LEFT JOIN customers c ON c.id = d.customer_id
      WHERE d.status <> 'DRAFT'
        AND (${patron} = '%%'
             OR d.full_number ILIKE ${patron}
             OR d.control_number ILIKE ${patron}
             OR c.name ILIKE ${patron})
        AND (${input.kind ?? null}::text IS NULL OR d.kind::text = ${input.kind ?? null})
        AND (${input.status ?? null}::text IS NULL OR d.status::text = ${input.status ?? null})
        AND (${input.customerId ?? null}::uuid IS NULL OR d.customer_id = ${input.customerId ?? null}::uuid)
        AND (${input.from ?? null}::date IS NULL
             OR (d.issued_at AT TIME ZONE 'America/Caracas')::date >= ${input.from ?? null}::date)
        AND (${input.to ?? null}::date IS NULL
             OR (d.issued_at AT TIME ZONE 'America/Caracas')::date <= ${input.to ?? null}::date)
      ORDER BY d.issued_at DESC
      LIMIT ${limite}
    `),
  )

  return [...filas].map((fila) => ({
    documentId: fila.id,
    kind: fila.kind,
    fullNumber: fila.full_number,
    controlNumber: fila.control_number,
    status: fila.status,
    issuedAt: fila.issued_at ? new Date(fila.issued_at) : null,
    customerName: fila.cliente,
    currency: fila.currency,
    totalVes: money('VES', BigInt(fila.total_ves)),
    totalUsd: money('USD', BigInt(fila.total_usd)),
  }))
}

/** Datos de la empresa que salen impresos en cada documento. */
export async function updateIssuer(
  db: Database,
  input: {
    tenantId: string
    tradeName?: string | null | undefined
    legalName?: string | null | undefined
    address?: string | null | undefined
    city?: string | null | undefined
    phone?: string | null | undefined
    email?: string | null | undefined
    website?: string | null | undefined
    documentFooter?: string | null | undefined
  },
): Promise<void> {
  const cambios: Record<string, unknown> = { updatedAt: new Date() }
  for (const campo of [
    'tradeName',
    'legalName',
    'address',
    'city',
    'phone',
    'email',
    'website',
    'documentFooter',
  ] as const) {
    if (input[campo] !== undefined) cambios[campo] = input[campo]
  }
  if (Object.keys(cambios).length === 1) return

  await withTenant(db, input.tenantId, (tx) =>
    tx.update(schema.tenants).set(cambios).where(eq(schema.tenants.id, input.tenantId)),
  )
}

/** Datos del negocio, para la pantalla de configuración. */
export async function getIssuer(db: Database, tenantId: string): Promise<DocumentIssuer & { rifKind: string }> {
  const filas = await withTenant(db, tenantId, (tx) =>
    tx.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1),
  )

  const negocio = filas[0]
  if (!negocio) throw new DocumentNotFoundError(tenantId)

  return {
    name: negocio.tradeName ?? negocio.name,
    legalName: negocio.legalName ?? negocio.name,
    rif: `${negocio.rifKind}-${negocio.rifNumber}`,
    rifKind: negocio.rifKind,
    address: negocio.address,
    city: negocio.city,
    phone: negocio.phone,
    email: negocio.email,
    website: negocio.website,
    footer: negocio.documentFooter,
  }
}

export interface ControlBook {
  readonly seriesId: string
  readonly kind: DocumentKind
  readonly prefix: string | null
  readonly next: number | null
  readonly last: number | null
  /** Cuántos quedan en el talonario. */
  readonly remaining: number
}

/**
 * Carga el rango de números de control de un talonario nuevo.
 *
 * Los números vienen preimpresos por la imprenta autorizada: el negocio recibe
 * el talonario y le dice al sistema desde dónde hasta dónde va. El sistema solo
 * los reparte en orden.
 */
export async function setControlRange(
  db: Database,
  input: { tenantId: string; kind: DocumentKind; prefix?: string | null; from: number; to: number },
): Promise<void> {
  if (input.from < 1 || input.to < input.from) {
    throw new DocumentNotFoundError('El rango del talonario es inválido.')
  }

  await withTenant(db, input.tenantId, (tx) =>
    tx
      .update(schema.documentSeries)
      .set({
        controlPrefix: input.prefix ?? null,
        controlNext: input.from,
        controlLast: input.to,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.documentSeries.tenantId, input.tenantId),
          eq(schema.documentSeries.kind, input.kind),
        ),
      ),
  )
}

/** Estado de los talonarios. Avisa antes de quedarse sin papel. */
export async function listControlBooks(db: Database, tenantId: string): Promise<ControlBook[]> {
  const filas = await withTenant(db, tenantId, (tx) =>
    tx.select().from(schema.documentSeries).where(eq(schema.documentSeries.tenantId, tenantId)),
  )

  return filas.map((fila) => ({
    seriesId: fila.id,
    kind: fila.kind,
    prefix: fila.controlPrefix,
    next: fila.controlNext,
    last: fila.controlLast,
    remaining:
      fila.controlNext !== null && fila.controlLast !== null ? Math.max(0, fila.controlLast - fila.controlNext + 1) : 0,
  }))
}
