import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { schema, withTenant, type Database } from '@fve/db'

import { CoreError, MissingSeriesError } from './errors'
import type { DocumentKind } from './sales'

/** El número que trae la venta no pertenece a ningún bloque vigente. */
export class NumberNotReservedError extends CoreError {
  override readonly name = 'NumberNotReservedError'
  constructor(readonly number: number) {
    super(
      `El número ${number} no pertenece a ningún bloque reservado para esta caja. No se emite: un consecutivo inventado descuadra la serie.`,
    )
  }
}

/** El bloque ya se consumió o se liberó. */
export class NumberAlreadyUsedError extends CoreError {
  override readonly name = 'NumberAlreadyUsedError'
  constructor(readonly number: number) {
    super(`El número ${number} ya fue usado.`)
  }
}

export class InvalidBlockSizeError extends CoreError {
  override readonly name = 'InvalidBlockSizeError'
  constructor() {
    super('El tamaño del bloque debe estar entre 1 y 1000.')
  }
}

/** Bloques de más de mil números vuelven demasiado costoso un hueco. */
export const MAX_BLOCK_SIZE = 1000

export interface NumberBlock {
  readonly reservationId: string
  readonly seriesId: string
  readonly kind: DocumentKind
  readonly prefix: string
  readonly from: number
  readonly to: number
  /** Último número efectivamente emitido. Nulo si el bloque está sin estrenar. */
  readonly consumedUpTo: number | null
  /** Cuántos quedan por usar. */
  readonly remaining: number
}

function toBlock(row: {
  id: string
  seriesId: string
  kind: DocumentKind
  prefix: string
  fromNumber: number
  toNumber: number
  consumedUpTo: number | null
}): NumberBlock {
  const usados = row.consumedUpTo === null ? 0 : row.consumedUpTo - row.fromNumber + 1
  return {
    reservationId: row.id,
    seriesId: row.seriesId,
    kind: row.kind,
    prefix: row.prefix,
    from: row.fromNumber,
    to: row.toNumber,
    consumedUpTo: row.consumedUpTo,
    remaining: row.toNumber - row.fromNumber + 1 - usados,
  }
}

/**
 * Reserva un bloque de consecutivos para una caja.
 *
 * La caja lo pide estando en línea y lo va gastando sin conexión. Los números
 * salen de la misma serie que usa la venta normal, así que una caja en línea y
 * otra sin conexión no pueden coincidir jamás: el bloque queda apartado en el
 * momento de reservarlo, no cuando se usa.
 *
 * Si sobran números, se liberan y quedan como hueco en la numeración. Un hueco
 * justificado en el libro de ventas es molesto; un consecutivo duplicado es
 * insalvable.
 */
export async function reserveNumberBlock(
  db: Database,
  input: { tenantId: string; stationId: string; kind: DocumentKind; count: number; userId?: string | undefined },
): Promise<NumberBlock> {
  if (!Number.isInteger(input.count) || input.count < 1 || input.count > MAX_BLOCK_SIZE) {
    throw new InvalidBlockSizeError()
  }

  return withTenant(db, input.tenantId, async (tx) => {
    const seriesRows = await tx
      .select()
      .from(schema.documentSeries)
      .where(
        and(
          eq(schema.documentSeries.tenantId, input.tenantId),
          eq(schema.documentSeries.kind, input.kind),
          eq(schema.documentSeries.isActive, true),
        ),
      )
      .limit(1)

    const series = seriesRows[0]
    if (!series) throw new MissingSeriesError(input.kind)

    // El UPDATE toma un candado sobre la fila de la serie: dos cajas pidiendo
    // bloques a la vez se serializan aquí y reciben rangos disjuntos.
    const asignado = await tx.execute<{ desde: number }>(sql`
      UPDATE document_series
      SET next_number = next_number + ${input.count}, updated_at = now()
      WHERE id = ${series.id}
      RETURNING next_number - ${input.count} AS desde
    `)

    const desde = Number([...asignado][0]?.desde)
    const hasta = desde + input.count - 1

    const [reserva] = await tx
      .insert(schema.numberReservations)
      .values({
        tenantId: input.tenantId,
        seriesId: series.id,
        stationId: input.stationId,
        fromNumber: desde,
        toNumber: hasta,
      })
      .returning({ id: schema.numberReservations.id })

    if (!reserva) throw new MissingSeriesError(input.kind)

    await tx.insert(schema.auditLog).values({
      tenantId: input.tenantId,
      actorUserId: input.userId ?? null,
      action: 'CREATE',
      entity: 'number_reservations',
      entityId: reserva.id,
      after: { kind: input.kind, desde, hasta },
    })

    return toBlock({
      id: reserva.id,
      seriesId: series.id,
      kind: input.kind,
      prefix: series.prefix,
      fromNumber: desde,
      toNumber: hasta,
      consumedUpTo: null,
    })
  })
}

/** Bloques vigentes de una caja, del más antiguo al más nuevo. */
export async function listNumberBlocks(
  db: Database,
  input: { tenantId: string; stationId: string },
): Promise<NumberBlock[]> {
  const rows = await withTenant(db, input.tenantId, (tx) =>
    tx
      .select({
        id: schema.numberReservations.id,
        seriesId: schema.numberReservations.seriesId,
        kind: schema.documentSeries.kind,
        prefix: schema.documentSeries.prefix,
        fromNumber: schema.numberReservations.fromNumber,
        toNumber: schema.numberReservations.toNumber,
        consumedUpTo: schema.numberReservations.consumedUpTo,
      })
      .from(schema.numberReservations)
      .innerJoin(schema.documentSeries, eq(schema.documentSeries.id, schema.numberReservations.seriesId))
      .where(
        and(
          eq(schema.numberReservations.tenantId, input.tenantId),
          eq(schema.numberReservations.stationId, input.stationId),
          isNull(schema.numberReservations.releasedAt),
        ),
      )
      .orderBy(asc(schema.numberReservations.fromNumber)),
  )

  return rows.map(toBlock).filter((bloque) => bloque.remaining > 0)
}

/**
 * Libera lo que quede de un bloque.
 *
 * Los números sin usar NO vuelven a la serie: quedan como hueco. Reciclarlos
 * abriría la puerta a que una caja que estuvo sin conexión emita más tarde un
 * número que otra ya usó.
 */
export async function releaseNumberBlock(
  db: Database,
  input: { tenantId: string; reservationId: string; now?: Date | undefined },
): Promise<void> {
  const now = input.now ?? new Date()
  await withTenant(db, input.tenantId, (tx) =>
    tx
      .update(schema.numberReservations)
      .set({ releasedAt: now })
      .where(eq(schema.numberReservations.id, input.reservationId)),
  )
}

/**
 * Comprueba que un número reservado se puede usar y lo marca como consumido.
 *
 * Se llama dentro de la transacción de la venta. Devuelve la serie a la que
 * pertenece para que el documento quede bien enlazado.
 */
export async function consumeReservedNumber(
  tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  input: { tenantId: string; stationId: string; kind: DocumentKind; number: number },
): Promise<{ seriesId: string; prefix: string }> {
  const rows = await tx
    .select({
      id: schema.numberReservations.id,
      seriesId: schema.numberReservations.seriesId,
      prefix: schema.documentSeries.prefix,
      fromNumber: schema.numberReservations.fromNumber,
      toNumber: schema.numberReservations.toNumber,
      consumedUpTo: schema.numberReservations.consumedUpTo,
      releasedAt: schema.numberReservations.releasedAt,
    })
    .from(schema.numberReservations)
    .innerJoin(schema.documentSeries, eq(schema.documentSeries.id, schema.numberReservations.seriesId))
    .where(
      and(
        eq(schema.numberReservations.tenantId, input.tenantId),
        eq(schema.numberReservations.stationId, input.stationId),
        eq(schema.documentSeries.kind, input.kind),
        sql`${schema.numberReservations.fromNumber} <= ${input.number}`,
        sql`${schema.numberReservations.toNumber} >= ${input.number}`,
      ),
    )
    .limit(1)

  const bloque = rows[0]
  if (!bloque || bloque.releasedAt !== null) {
    throw new NumberNotReservedError(input.number)
  }
  if (bloque.consumedUpTo !== null && input.number <= bloque.consumedUpTo) {
    throw new NumberAlreadyUsedError(input.number)
  }

  await tx
    .update(schema.numberReservations)
    .set({ consumedUpTo: input.number })
    .where(eq(schema.numberReservations.id, bloque.id))

  return { seriesId: bloque.seriesId, prefix: bloque.prefix }
}
