import { and, eq, isNull, sql } from 'drizzle-orm'
import { schema, withTenant, type Database } from '@fve/db'
import {
  alicuota,
  computeLine,
  computeTotals,
  convert,
  isPositive,
  money,
  settle,
  toDecimalString,
  zero,
  type Alicuota,
  type Currency,
  type DocumentTotals,
  type LineResult,
  type Money,
  type PaymentInput,
  type PriceMode,
  type Rate,
  type Settlement,
} from '@fve/money'

import {
  AlreadyCreditedError,
  CreditRequiresCustomerError,
  DocumentNotFoundError,
  EmptySaleError,
  MissingSeriesError,
  NotCreditableError,
  NotVoidableError,
  ProductUnavailableError,
  UnsettledSaleError,
} from './errors'
import { consumeReservedNumber } from './numbering'
import { getRateFor, toIsoDate, type StoredRate } from './rates'

export type DocumentKind = 'FACTURA' | 'PRESUPUESTO' | 'NOTA_ENTREGA' | 'RECIBO' | 'NOTA_CREDITO'

export interface SaleLineInput {
  /** Producto del catálogo. Si va, el precio y la alícuota salen de él. */
  readonly productId?: string | undefined
  /** Línea libre: exige descripción, precio y alícuota. */
  readonly description?: string | undefined
  readonly taxRateId?: string | undefined
  /** Cantidad en milésimas: 1500 son 1,5 unidades. */
  readonly quantity: bigint
  /** Precio unitario que pisa al del catálogo. En cualquier moneda. */
  readonly unitPrice?: Money | undefined
  readonly discountBps?: number | undefined
}

export interface CreateSaleInput {
  readonly tenantId: string
  readonly stationId: string
  readonly userId: string
  readonly customerId?: string | undefined
  /**
   * Turno de caja. Si no se indica, se toma el turno abierto de la estación:
   * una venta hecha con la caja abierta pertenece a ese turno, y depender de
   * que el llamador lo recuerde es pedirle a alguien que no se equivoque nunca.
   */
  readonly cashSessionId?: string | undefined
  readonly kind?: DocumentKind | undefined
  /** Lista de precios a aplicar (p. ej. mayor). Vacío = la predeterminada. */
  readonly priceListId?: string | undefined
  readonly currency: Currency
  readonly lines: readonly SaleLineInput[]
  readonly payments: readonly PaymentInput[]
  readonly changeCurrency?: Currency | undefined
  /**
   * Identificador que asigna la caja al crear la venta, incluso sin conexión.
   * Reenviar la misma venta dos veces devuelve el mismo documento en vez de
   * emitir uno nuevo.
   */
  readonly clientRef?: string | undefined
  /**
   * Número tomado de un bloque reservado, para ventas hechas sin conexión.
   *
   * Si va, se usa ese consecutivo en vez de pedir uno nuevo a la serie. Se
   * valida que pertenezca a un bloque vigente de ESTA caja: un número inventado
   * no se emite, porque descuadraría la serie sin remedio.
   */
  readonly reservedNumber?: number | undefined
  readonly notes?: string | undefined
  readonly now?: Date | undefined
}

export interface CreatedSale {
  readonly documentId: string
  readonly fullNumber: string
  readonly number: number
  readonly currency: Currency
  readonly totals: DocumentTotals
  readonly settlement: Settlement
  readonly rate: Rate
  /** Verdadero si la venta ya existía y se devolvió tal cual. */
  readonly deduplicated: boolean
}

/**
 * Emite una venta.
 *
 * Todo ocurre en una sola transacción: numerar, calcular, persistir el
 * documento con su desglose, mover inventario y abrir la cuenta por cobrar. Si
 * algo falla, no queda un consecutivo quemado ni un inventario descuadrado.
 *
 * El documento nace en `DRAFT` y pasa a `ISSUED` al final, porque los disparadores
 * de inmutabilidad impiden agregarle líneas a un documento ya emitido. No es un
 * rodeo: es el orden correcto —se arma y luego se emite— y el hecho de que la
 * base lo exija es justamente lo que se quería.
 */
export async function createSale(db: Database, input: CreateSaleInput): Promise<CreatedSale> {
  if (input.lines.length === 0) throw new EmptySaleError()

  const now = input.now ?? new Date()
  const kind: DocumentKind = input.kind ?? 'NOTA_ENTREGA'
  /*
   * Un presupuesto es una cotización, no una venta: se numera y se imprime con
   * sus precios, pero no se cobra, no descuenta inventario ni abre cuenta por
   * cobrar. Por eso se ignoran sus pagos y no se exige que quede saldado.
   */
  const esCotizacion = kind === 'PRESUPUESTO'
  const rate = await getRateFor(db, input.tenantId, toIsoDate(now))

  return withTenant(db, input.tenantId, async (tx) => {
    // --- Idempotencia -------------------------------------------------------
    if (input.clientRef) {
      const existing = await tx
        .select()
        .from(schema.documents)
        .where(and(eq(schema.documents.tenantId, input.tenantId), eq(schema.documents.clientRef, input.clientRef)))
        .limit(1)

      const previous = existing[0]
      if (previous) {
        return rebuildFromStored(tx, previous, rate)
      }
    }

    // --- Turno de caja ------------------------------------------------------
    let cashSessionId = input.cashSessionId ?? null
    if (!cashSessionId) {
      const open = await tx
        .select({ id: schema.cashSessions.id })
        .from(schema.cashSessions)
        .where(and(eq(schema.cashSessions.stationId, input.stationId), isNull(schema.cashSessions.closedAt)))
        .limit(1)
      cashSessionId = open[0]?.id ?? null
    }

    // --- Configuración del negocio -----------------------------------------
    const tenantRows = await tx.select().from(schema.tenants).where(eq(schema.tenants.id, input.tenantId)).limit(1)
    const igtfBps = tenantRows[0]?.igtfBps ?? 300

    // --- Resolución de líneas ----------------------------------------------
    const resolved = await resolveLines(tx, input, rate)
    const lineResults = resolved.map((line) => computeLine(line.computeInput))
    const totals = computeTotals(lineResults, input.currency)

    // --- Cobro --------------------------------------------------------------
    const settlement = settle({
      total: totals.total,
      payments: esCotizacion ? [] : input.payments,
      rate,
      igtfBps,
      ...(input.changeCurrency !== undefined ? { changeCurrency: input.changeCurrency } : {}),
    })

    if (!esCotizacion && isPositive(settlement.balance)) {
      throw new UnsettledSaleError(toDecimalString(settlement.balance))
    }
    if (isPositive(settlement.credit) && !input.customerId) {
      throw new CreditRequiresCustomerError()
    }

    // --- Numeración ---------------------------------------------------------
    let seriesId: string
    let prefix: string
    let assigned: number

    if (input.reservedNumber !== undefined) {
      // Venta hecha sin conexión: el número ya venía apartado para esta caja.
      const bloque = await consumeReservedNumber(tx, {
        tenantId: input.tenantId,
        stationId: input.stationId,
        kind,
        number: input.reservedNumber,
      })
      seriesId = bloque.seriesId
      prefix = bloque.prefix
      assigned = input.reservedNumber
    } else {
      const seriesRows = await tx
        .select()
        .from(schema.documentSeries)
        .where(
          and(
            eq(schema.documentSeries.tenantId, input.tenantId),
            eq(schema.documentSeries.kind, kind),
            eq(schema.documentSeries.isActive, true),
          ),
        )
        .limit(1)

      const series = seriesRows[0]
      if (!series) throw new MissingSeriesError(kind)

      // El UPDATE toma un candado sobre la fila de la serie, así que dos ventas
      // simultáneas se serializan aquí y no pueden recibir el mismo número.
      const assignedRows = await tx.execute<{ assigned: number }>(sql`
        UPDATE document_series
        SET next_number = next_number + 1, updated_at = now()
        WHERE id = ${series.id}
        RETURNING next_number - 1 AS assigned
      `)
      seriesId = series.id
      prefix = series.prefix
      assigned = Number([...assignedRows][0]?.assigned)
    }

    const fullNumber = `${prefix}-${String(assigned).padStart(6, '0')}`

    /*
     * Número de control del talonario de la imprenta autorizada.
     *
     * Solo lo lleva la factura, y solo si el negocio cargó su rango. No lo
     * inventa el sistema: viene preimpreso en el papel, así que si el talonario
     * se acabó la factura sale sin control y el negocio tiene que cargar el
     * siguiente. Detener la venta por eso sería peor.
     */
    let controlNumber: string | null = null
    if (kind === 'FACTURA') {
      const asignadoControl = await tx.execute<{ numero: number | null; prefijo: string | null }>(sql`
        UPDATE document_series
        SET control_next = control_next + 1
        WHERE id = ${seriesId}
          AND control_next IS NOT NULL
          AND (control_last IS NULL OR control_next <= control_last)
        RETURNING control_next - 1 AS numero, control_prefix AS prefijo
      `)
      const fila = [...asignadoControl][0]
      if (fila?.numero != null) {
        controlNumber = `${fila.prefijo ?? ''}${String(fila.numero).padStart(8, '0')}`
      }
    }

    // --- Persistencia -------------------------------------------------------
    const amounts = dualizeTotals(totals, settlement, rate, input.currency)

    const [inserted] = await tx
      .insert(schema.documents)
      .values({
        tenantId: input.tenantId,
        kind,
        seriesId,
        number: assigned,
        fullNumber,
        controlNumber,
        stationId: input.stationId,
        cashSessionId,
        issuedByUserId: input.userId,
        customerId: input.customerId ?? null,
        status: 'DRAFT',
        currency: input.currency,
        exchangeRateId: rate.id,
        rateBsPerUsd: rate.bsPerUsd,
        rateEffectiveOn: rate.date,
        changeAmount: settlement.change.amount,
        changeCurrency: isPositive(settlement.change) ? settlement.changeCurrency : null,
        notes: input.notes ?? null,
        clientRef: input.clientRef ?? null,
        ...amounts,
      })
      .returning({ id: schema.documents.id })

    if (!inserted) throw new EmptySaleError()
    const documentId = inserted.id

    await tx.insert(schema.documentLines).values(
      lineResults.map((line, index) => {
        const source = resolved[index]
        return {
          tenantId: input.tenantId,
          documentId,
          lineNumber: index + 1,
          productId: source?.productId ?? null,
          sku: source?.sku ?? null,
          description: source?.description ?? '',
          unit: source?.unit ?? 'UND',
          quantity: source?.computeInput.quantity ?? 0n,
          unitPrice: source?.computeInput.unitPrice.amount ?? 0n,
          discountBps: source?.computeInput.discountBps ?? 0,
          priceMode: source?.computeInput.priceMode ?? 'IVA_INCLUIDO',
          taxRateId: source?.taxRateId ?? null,
          taxCode: line.alicuota.codigo,
          taxBaseBps: line.alicuota.baseBps,
          taxAdicionalBps: line.alicuota.adicionalBps,
          gross: line.gross.amount,
          discount: line.discount.amount,
          base: line.base.amount,
          ivaBase: line.ivaBase.amount,
          ivaAdicional: line.ivaAdicional.amount,
          total: line.total.amount,
        }
      }),
    )

    if (totals.byAlicuota.length > 0) {
      await tx.insert(schema.documentTaxBreakdown).values(
        totals.byAlicuota.map((row) => ({
          tenantId: input.tenantId,
          documentId,
          taxCode: row.alicuota.codigo,
          baseBps: row.alicuota.baseBps,
          adicionalBps: row.alicuota.adicionalBps,
          baseUsd: convert(row.base, 'USD', rate).amount,
          baseVes: convert(row.base, 'VES', rate).amount,
          ivaBaseUsd: convert(row.ivaBase, 'USD', rate).amount,
          ivaBaseVes: convert(row.ivaBase, 'VES', rate).amount,
          ivaAdicionalUsd: convert(row.ivaAdicional, 'USD', rate).amount,
          ivaAdicionalVes: convert(row.ivaAdicional, 'VES', rate).amount,
        })),
      )
    }

    if (settlement.payments.length > 0) {
      await tx.insert(schema.documentPayments).values(
        settlement.payments.map((payment) => ({
          tenantId: input.tenantId,
          documentId,
          method: payment.method,
          currency: payment.amount.currency,
          amount: payment.amount.amount,
          amountUsd: convert(payment.amount, 'USD', rate).amount,
          amountVes: convert(payment.amount, 'VES', rate).amount,
          isDivisa: payment.spec.divisa,
          reference: payment.reference ?? null,
          receivedAt: now,
        })),
      )
    }

    // Emitir es el último paso: a partir de aquí el documento es inmutable.
    await tx.update(schema.documents).set({ status: 'ISSUED', issuedAt: now }).where(eq(schema.documents.id, documentId))

    // --- Inventario ---------------------------------------------------------
    // Un presupuesto no mueve inventario: es una cotización, no una salida.
    const stockLines = esCotizacion ? [] : resolved.filter((line) => line.tracksStock && line.productId)
    if (stockLines.length > 0) {
      await tx.insert(schema.stockMovements).values(
        stockLines.map((line) => ({
          tenantId: input.tenantId,
          productId: line.productId as string,
          kind: 'SALE' as const,
          quantity: -line.computeInput.quantity,
          documentId,
          createdByUserId: input.userId,
          occurredAt: now,
        })),
      )
    }

    // --- Cuenta por cobrar --------------------------------------------------
    if (isPositive(settlement.credit)) {
      await tx.insert(schema.receivables).values({
        tenantId: input.tenantId,
        documentId,
        customerId: input.customerId as string,
        currency: input.currency,
        originalAmount: settlement.credit.amount,
      })
    }

    await tx.insert(schema.auditLog).values({
      tenantId: input.tenantId,
      actorUserId: input.userId,
      action: 'ISSUE',
      entity: 'documents',
      entityId: documentId,
      after: { fullNumber, total: toDecimalString(settlement.totalDue) },
      occurredAt: now,
    })

    return {
      documentId,
      fullNumber,
      number: assigned,
      currency: input.currency,
      totals,
      settlement,
      rate,
      deduplicated: false,
    }
  })
}

/**
 * Anula un documento emitido.
 *
 * No lo borra ni lo edita: el consecutivo y la fila se conservan, porque un
 * hueco en la numeración es lo primero que pregunta una fiscalización. Se
 * revierte el inventario y se cierra la cuenta por cobrar si la había.
 */
export async function voidSale(
  db: Database,
  input: { tenantId: string; documentId: string; userId: string; reason: string; now?: Date | undefined },
): Promise<void> {
  const now = input.now ?? new Date()

  await withTenant(db, input.tenantId, async (tx) => {
    const rows = await tx.select().from(schema.documents).where(eq(schema.documents.id, input.documentId)).limit(1)
    const document = rows[0]
    if (!document) throw new DocumentNotFoundError(input.documentId)
    if (document.status !== 'ISSUED') throw new NotVoidableError(document.status)

    await tx
      .update(schema.documents)
      .set({ status: 'VOIDED', voidedAt: now, voidReason: input.reason })
      .where(eq(schema.documents.id, input.documentId))

    const movements = await tx
      .select()
      .from(schema.stockMovements)
      .where(eq(schema.stockMovements.documentId, input.documentId))

    const reversals = movements.filter((movement) => movement.kind === 'SALE')
    if (reversals.length > 0) {
      await tx.insert(schema.stockMovements).values(
        reversals.map((movement) => ({
          tenantId: input.tenantId,
          productId: movement.productId,
          kind: 'RETURN' as const,
          quantity: -movement.quantity,
          documentId: input.documentId,
          reason: `Anulación de ${document.fullNumber}`,
          createdByUserId: input.userId,
          occurredAt: now,
        })),
      )
    }

    await tx
      .update(schema.receivables)
      .set({ settledAt: now })
      .where(eq(schema.receivables.documentId, input.documentId))

    await tx.insert(schema.auditLog).values({
      tenantId: input.tenantId,
      actorUserId: input.userId,
      action: 'VOID',
      entity: 'documents',
      entityId: input.documentId,
      after: { fullNumber: document.fullNumber, reason: input.reason },
      occurredAt: now,
    })
  })
}

export interface CreatedCreditNote {
  readonly documentId: string
  readonly fullNumber: string
}

/**
 * Emite una nota de crédito por la devolución total de un documento de venta.
 *
 * No anula el original —que ya está en manos del cliente— sino que emite un
 * documento nuevo que lo acredita. Sus importes se guardan en NEGATIVO, copiados
 * del original a su misma tasa, de modo que los reportes lo restan solos al
 * sumar: una nota de crédito reduce las ventas y la ganancia del período sin que
 * el libro tenga que tratarla aparte. Devuelve la mercancía al inventario y, si
 * el original quedó a crédito, salda su cuenta por cobrar.
 */
export async function createCreditNote(
  db: Database,
  input: { tenantId: string; documentId: string; userId: string; reason: string; now?: Date | undefined },
): Promise<CreatedCreditNote> {
  const now = input.now ?? new Date()

  return withTenant(db, input.tenantId, async (tx) => {
    const [original] = await tx
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, input.documentId))
      .limit(1)
    if (!original) throw new DocumentNotFoundError(input.documentId)
    if (original.status !== 'ISSUED') {
      throw new NotCreditableError(`Solo se acredita un documento emitido; este está en ${original.status}.`)
    }
    if (original.kind === 'PRESUPUESTO' || original.kind === 'NOTA_CREDITO') {
      throw new NotCreditableError('Un presupuesto o una nota de crédito no se acreditan.')
    }

    const yaAcreditado = await tx
      .select({ id: schema.documents.id })
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.relatedDocumentId, input.documentId),
          eq(schema.documents.kind, 'NOTA_CREDITO'),
        ),
      )
      .limit(1)
    if (yaAcreditado[0]) throw new AlreadyCreditedError()

    const seriesRows = await tx
      .select()
      .from(schema.documentSeries)
      .where(
        and(
          eq(schema.documentSeries.tenantId, input.tenantId),
          eq(schema.documentSeries.kind, 'NOTA_CREDITO'),
          eq(schema.documentSeries.isActive, true),
        ),
      )
      .limit(1)
    const series = seriesRows[0]
    if (!series) throw new MissingSeriesError('NOTA_CREDITO')

    const assignedRows = await tx.execute<{ assigned: number }>(sql`
      UPDATE document_series SET next_number = next_number + 1, updated_at = now()
      WHERE id = ${series.id} RETURNING next_number - 1 AS assigned
    `)
    const assigned = Number([...assignedRows][0]?.assigned)
    const fullNumber = `${series.prefix}-${String(assigned).padStart(6, '0')}`

    const neg = (v: bigint) => -v
    const origRate: Rate = { bsPerUsd: original.rateBsPerUsd, date: original.rateEffectiveOn, source: 'BCV' }

    const [inserted] = await tx
      .insert(schema.documents)
      .values({
        tenantId: input.tenantId,
        kind: 'NOTA_CREDITO',
        seriesId: series.id,
        number: assigned,
        fullNumber,
        stationId: original.stationId,
        issuedByUserId: input.userId,
        customerId: original.customerId,
        relatedDocumentId: original.id,
        status: 'DRAFT',
        currency: original.currency,
        exchangeRateId: original.exchangeRateId,
        rateBsPerUsd: original.rateBsPerUsd,
        rateEffectiveOn: original.rateEffectiveOn,
        grossUsd: neg(original.grossUsd),
        grossVes: neg(original.grossVes),
        discountUsd: neg(original.discountUsd),
        discountVes: neg(original.discountVes),
        taxableBaseUsd: neg(original.taxableBaseUsd),
        taxableBaseVes: neg(original.taxableBaseVes),
        exemptBaseUsd: neg(original.exemptBaseUsd),
        exemptBaseVes: neg(original.exemptBaseVes),
        ivaBaseUsd: neg(original.ivaBaseUsd),
        ivaBaseVes: neg(original.ivaBaseVes),
        ivaAdicionalUsd: neg(original.ivaAdicionalUsd),
        ivaAdicionalVes: neg(original.ivaAdicionalVes),
        totalUsd: neg(original.totalUsd),
        totalVes: neg(original.totalVes),
        igtfUsd: neg(original.igtfUsd),
        igtfVes: neg(original.igtfVes),
        grandTotalUsd: neg(original.grandTotalUsd),
        grandTotalVes: neg(original.grandTotalVes),
        notes: input.reason,
      })
      .returning({ id: schema.documents.id })
    if (!inserted) throw new DocumentNotFoundError(input.documentId)
    const creditId = inserted.id

    const lines = await tx
      .select()
      .from(schema.documentLines)
      .where(eq(schema.documentLines.documentId, original.id))
      .orderBy(schema.documentLines.lineNumber)
    if (lines.length > 0) {
      await tx.insert(schema.documentLines).values(
        lines.map((l) => ({
          tenantId: input.tenantId,
          documentId: creditId,
          lineNumber: l.lineNumber,
          productId: l.productId,
          sku: l.sku,
          description: l.description,
          unit: l.unit,
          quantity: neg(l.quantity),
          unitPrice: l.unitPrice,
          discountBps: l.discountBps,
          priceMode: l.priceMode,
          taxRateId: l.taxRateId,
          taxCode: l.taxCode,
          taxBaseBps: l.taxBaseBps,
          taxAdicionalBps: l.taxAdicionalBps,
          gross: neg(l.gross),
          discount: neg(l.discount),
          base: neg(l.base),
          ivaBase: neg(l.ivaBase),
          ivaAdicional: neg(l.ivaAdicional),
          total: neg(l.total),
        })),
      )
    }

    const taxes = await tx
      .select()
      .from(schema.documentTaxBreakdown)
      .where(eq(schema.documentTaxBreakdown.documentId, original.id))
    if (taxes.length > 0) {
      await tx.insert(schema.documentTaxBreakdown).values(
        taxes.map((t) => ({
          tenantId: input.tenantId,
          documentId: creditId,
          taxCode: t.taxCode,
          baseBps: t.baseBps,
          adicionalBps: t.adicionalBps,
          baseUsd: neg(t.baseUsd),
          baseVes: neg(t.baseVes),
          ivaBaseUsd: neg(t.ivaBaseUsd),
          ivaBaseVes: neg(t.ivaBaseVes),
          ivaAdicionalUsd: neg(t.ivaAdicionalUsd),
          ivaAdicionalVes: neg(t.ivaAdicionalVes),
        })),
      )
    }

    await tx.update(schema.documents).set({ status: 'ISSUED', issuedAt: now }).where(eq(schema.documents.id, creditId))

    // Devolver la mercancía: por cada movimiento de venta del original, un retorno.
    const movements = await tx
      .select()
      .from(schema.stockMovements)
      .where(eq(schema.stockMovements.documentId, original.id))
    const sales = movements.filter((m) => m.kind === 'SALE')
    if (sales.length > 0) {
      await tx.insert(schema.stockMovements).values(
        sales.map((m) => ({
          tenantId: input.tenantId,
          productId: m.productId,
          kind: 'RETURN' as const,
          quantity: neg(m.quantity), // el de venta era negativo; esto repone
          documentId: creditId,
          reason: `Nota de crédito ${fullNumber} de ${original.fullNumber}`,
          createdByUserId: input.userId,
          occurredAt: now,
        })),
      )
    }

    // Si el original quedó a crédito y sigue abierto, la nota de crédito lo salda.
    const [receivable] = await tx
      .select()
      .from(schema.receivables)
      .where(and(eq(schema.receivables.documentId, original.id), isNull(schema.receivables.settledAt)))
      .limit(1)
    if (receivable) {
      const paidRows = await tx.execute<{ paid: string }>(sql`
        SELECT COALESCE(SUM(CASE WHEN ${receivable.currency} = 'USD' THEN amount_usd ELSE amount_ves END), 0)::text AS paid
        FROM receivable_entries WHERE receivable_id = ${receivable.id}
      `)
      const pending = receivable.originalAmount - BigInt([...paidRows][0]?.paid ?? '0')
      if (pending > 0n) {
        const credited = money(receivable.currency, pending)
        await tx.insert(schema.receivableEntries).values({
          tenantId: input.tenantId,
          receivableId: receivable.id,
          kind: 'CREDIT_NOTE',
          currency: receivable.currency,
          amount: pending,
          amountUsd: convert(credited, 'USD', origRate).amount,
          amountVes: convert(credited, 'VES', origRate).amount,
          exchangeRateId: original.exchangeRateId,
          rateBsPerUsd: original.rateBsPerUsd,
          reference: fullNumber,
          occurredAt: now,
          createdByUserId: input.userId,
        })
        await tx.update(schema.receivables).set({ settledAt: now }).where(eq(schema.receivables.id, receivable.id))
      }
    }

    await tx.insert(schema.auditLog).values({
      tenantId: input.tenantId,
      actorUserId: input.userId,
      action: 'ISSUE',
      entity: 'documents',
      entityId: creditId,
      after: { fullNumber, relatedTo: original.fullNumber, reason: input.reason },
      occurredAt: now,
    })

    return { documentId: creditId, fullNumber }
  })
}

// --- Interno ----------------------------------------------------------------

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]

interface ResolvedLine {
  readonly productId: string | null
  readonly sku: string | null
  readonly description: string
  readonly unit: string
  readonly taxRateId: string | null
  readonly tracksStock: boolean
  readonly computeInput: {
    quantity: bigint
    unitPrice: Money
    alicuota: Alicuota
    priceMode: PriceMode
    discountBps?: number | undefined
  }
}

async function resolveLines(tx: Transaction, input: CreateSaleInput, rate: Rate): Promise<ResolvedLine[]> {
  const resolved: ResolvedLine[] = []

  for (const line of input.lines) {
    if (line.quantity <= 0n) {
      throw new ProductUnavailableError('La cantidad de una línea debe ser mayor que cero.')
    }

    if (line.productId) {
      const rows = await tx
        .select()
        .from(schema.products)
        .innerJoin(schema.taxRates, eq(schema.taxRates.id, schema.products.taxRateId))
        .where(eq(schema.products.id, line.productId))
        .limit(1)

      const found = rows[0]
      if (!found || found.products.archivedAt !== null) {
        throw new ProductUnavailableError(`El producto ${line.productId} no está disponible.`)
      }

      const unitPrice = line.unitPrice
        ? convert(line.unitPrice, input.currency, rate)
        : convert(await priceOf(tx, found.products.id, input.currency, rate, input.priceListId), input.currency, rate)

      resolved.push({
        productId: found.products.id,
        sku: found.products.sku,
        description: found.products.name,
        unit: found.products.unit,
        taxRateId: found.tax_rates.id,
        tracksStock: found.products.tracksStock,
        computeInput: {
          quantity: line.quantity,
          unitPrice,
          alicuota: alicuota(
            found.tax_rates.code,
            found.tax_rates.name,
            found.tax_rates.baseBps,
            found.tax_rates.adicionalBps,
          ),
          priceMode: found.products.priceMode,
          ...(line.discountBps !== undefined ? { discountBps: line.discountBps } : {}),
        },
      })
      continue
    }

    // Línea libre: sin producto de catálogo.
    if (!line.description || !line.unitPrice || !line.taxRateId) {
      throw new ProductUnavailableError(
        'Una línea sin producto exige descripción, precio unitario y alícuota explícitos.',
      )
    }

    const taxRows = await tx.select().from(schema.taxRates).where(eq(schema.taxRates.id, line.taxRateId)).limit(1)
    const taxRate = taxRows[0]
    if (!taxRate) throw new ProductUnavailableError(`La alícuota ${line.taxRateId} no existe.`)

    resolved.push({
      productId: null,
      sku: null,
      description: line.description,
      unit: 'UND',
      taxRateId: taxRate.id,
      tracksStock: false,
      computeInput: {
        quantity: line.quantity,
        unitPrice: convert(line.unitPrice, input.currency, rate),
        alicuota: alicuota(taxRate.code, taxRate.name, taxRate.baseBps, taxRate.adicionalBps),
        priceMode: 'IVA_EXCLUIDO',
        ...(line.discountBps !== undefined ? { discountBps: line.discountBps } : {}),
      },
    })
  }

  return resolved
}

/**
 * Precio del producto en la lista indicada, con respaldo a la predeterminada.
 *
 * Si se pide una lista (p. ej. mayor) y el producto no tiene precio en ella, se
 * usa el de la lista predeterminada: así vender al mayor nunca deja un producto
 * sin precio por no haberlo cargado en las dos listas.
 */
async function priceOf(
  tx: Transaction,
  productId: string,
  target: Currency,
  rate: Rate,
  priceListId?: string | undefined,
): Promise<Money> {
  if (priceListId) {
    const sel = await tx
      .select({ currency: schema.productPrices.currency, unitPrice: schema.productPrices.unitPrice })
      .from(schema.productPrices)
      .where(and(eq(schema.productPrices.productId, productId), eq(schema.productPrices.priceListId, priceListId)))
      .limit(1)
    if (sel[0]) return convert(money(sel[0].currency, sel[0].unitPrice), target, rate)
  }

  const rows = await tx
    .select()
    .from(schema.productPrices)
    .innerJoin(schema.priceLists, eq(schema.priceLists.id, schema.productPrices.priceListId))
    .where(and(eq(schema.productPrices.productId, productId), eq(schema.priceLists.isDefault, true)))
    .limit(1)

  const found = rows[0]
  if (!found) {
    throw new ProductUnavailableError(`El producto ${productId} no tiene precio en la lista predeterminada.`)
  }

  return convert(money(found.product_prices.currency, found.product_prices.unitPrice), target, rate)
}

/**
 * Lleva los totales a las dos monedas.
 *
 * Cada componente se convierte por separado y el total se obtiene sumando los
 * componentes convertidos, no convirtiendo el total. Así `base + exento + IVA`
 * cuadra al céntimo en AMBAS monedas, que es lo que exige el libro de ventas.
 * Convertir el total por su cuenta podría dejarlo desviado un céntimo respecto a
 * sus propias partes, y un libro que no suma no sirve.
 */
function dualizeTotals(totals: DocumentTotals, settlement: Settlement, rate: Rate, currency: Currency) {
  const pair = (value: Money) => ({
    usd: convert(value, 'USD', rate).amount,
    ves: convert(value, 'VES', rate).amount,
  })

  const gross = pair(totals.gross)
  const discount = pair(totals.discount)
  const taxableBase = pair(totals.base)
  const exemptBase = pair(totals.exempt)
  const ivaBase = pair(totals.ivaBase)
  const ivaAdicional = pair(totals.ivaAdicional)
  const igtf = pair(settlement.igtf)

  const totalUsd = taxableBase.usd + exemptBase.usd + ivaBase.usd + ivaAdicional.usd
  const totalVes = taxableBase.ves + exemptBase.ves + ivaBase.ves + ivaAdicional.ves

  void currency

  return {
    grossUsd: gross.usd,
    grossVes: gross.ves,
    discountUsd: discount.usd,
    discountVes: discount.ves,
    taxableBaseUsd: taxableBase.usd,
    taxableBaseVes: taxableBase.ves,
    exemptBaseUsd: exemptBase.usd,
    exemptBaseVes: exemptBase.ves,
    ivaBaseUsd: ivaBase.usd,
    ivaBaseVes: ivaBase.ves,
    ivaAdicionalUsd: ivaAdicional.usd,
    ivaAdicionalVes: ivaAdicional.ves,
    totalUsd,
    totalVes,
    igtfUsd: igtf.usd,
    igtfVes: igtf.ves,
    grandTotalUsd: totalUsd + igtf.usd,
    grandTotalVes: totalVes + igtf.ves,
  }
}

/** Reconstruye el resultado de una venta ya emitida, para la idempotencia. */
async function rebuildFromStored(
  tx: Transaction,
  document: typeof schema.documents.$inferSelect,
  rate: StoredRate,
): Promise<CreatedSale> {
  const lines = await tx
    .select()
    .from(schema.documentLines)
    .where(eq(schema.documentLines.documentId, document.id))
    .orderBy(schema.documentLines.lineNumber)

  const currency = document.currency
  const lineResults: LineResult[] = lines.map((line) => {
    const rowAlicuota = alicuota(line.taxCode, line.taxCode, line.taxBaseBps, line.taxAdicionalBps)
    return {
      currency,
      alicuota: rowAlicuota,
      gross: money(currency, line.gross),
      discount: money(currency, line.discount),
      base: money(currency, line.base),
      ivaBase: money(currency, line.ivaBase),
      ivaAdicional: money(currency, line.ivaAdicional),
      ivaTotal: money(currency, line.ivaBase + line.ivaAdicional),
      total: money(currency, line.total),
    }
  })

  const totals = computeTotals(lineResults, currency)
  const stored = currency === 'USD' ? document.grandTotalUsd : document.grandTotalVes
  const igtfStored = currency === 'USD' ? document.igtfUsd : document.igtfVes

  const settlement: Settlement = Object.freeze({
    currency,
    documentTotal: totals.total,
    igtfBase: zero(currency),
    igtf: money(currency, igtfStored),
    totalDue: money(currency, stored),
    totalSettled: money(currency, stored),
    credit: zero(currency),
    balance: zero(currency),
    change: zero(currency),
    changeCurrency: currency,
    payments: [],
  })

  return {
    documentId: document.id,
    fullNumber: document.fullNumber,
    number: document.number,
    currency,
    totals,
    settlement,
    rate,
    deduplicated: true,
  }
}
