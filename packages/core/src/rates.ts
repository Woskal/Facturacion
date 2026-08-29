import { and, desc, eq, lte } from 'drizzle-orm'
import { schema, withTenant, type Database } from '@fve/db'
import { parseRate, rate as makeRate, type Rate, type RateSource } from '@fve/money'

import { MissingRateError } from './errors'

/** Fecha en formato `YYYY-MM-DD`, que es como la guarda la base. */
export type IsoDate = string

export function toIsoDate(value: Date): IsoDate {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Carga o corrige la tasa de un día.
 *
 * Corregir la tasa de hoy es normal —el BCV publica tarde, alguien la tecleó
 * mal— y por eso se permite. Lo que NO cambia es lo ya emitido: cada documento
 * guarda copiada la tasa con que se calculó, así que un cambio aquí no reescribe
 * el pasado.
 */
export async function setRate(
  db: Database,
  input: { tenantId: string; value: string; effectiveOn: IsoDate; source?: RateSource; userId?: string },
): Promise<Rate> {
  const parsed = parseRate(input.value, input.effectiveOn, input.source ?? 'BCV')

  await withTenant(db, input.tenantId, async (tx) => {
    await tx
      .insert(schema.exchangeRates)
      .values({
        tenantId: input.tenantId,
        bsPerUsd: parsed.bsPerUsd,
        effectiveOn: input.effectiveOn,
        source: parsed.source,
        createdBy: input.userId ?? null,
      })
      .onConflictDoUpdate({
        target: [schema.exchangeRates.tenantId, schema.exchangeRates.effectiveOn],
        set: { bsPerUsd: parsed.bsPerUsd, source: parsed.source },
      })
  })

  return parsed
}

export interface StoredRate extends Rate {
  readonly id: string
}

/**
 * Tasa vigente para una fecha.
 *
 * Si no hay tasa de ese día se usa la última anterior — un domingo se factura
 * con la del viernes, que es lo que hace todo el mundo. Lo que no se hace nunca
 * es usar una tasa posterior: eso sería reescribir el pasado con información que
 * en su momento no existía.
 */
export async function getRateFor(db: Database, tenantId: string, date: IsoDate): Promise<StoredRate> {
  const found = await withTenant(db, tenantId, async (tx) => {
    const rows = await tx
      .select()
      .from(schema.exchangeRates)
      .where(and(eq(schema.exchangeRates.tenantId, tenantId), lte(schema.exchangeRates.effectiveOn, date)))
      .orderBy(desc(schema.exchangeRates.effectiveOn))
      .limit(1)
    return rows[0]
  })

  if (!found) throw new MissingRateError(date)

  return {
    ...makeRate(found.bsPerUsd, found.effectiveOn, found.source),
    id: found.id,
  }
}

/** Tasa vigente hoy. */
export async function getCurrentRate(db: Database, tenantId: string, now: Date = new Date()): Promise<StoredRate> {
  return getRateFor(db, tenantId, toIsoDate(now))
}

/** Histórico de tasas, de la más reciente a la más antigua. */
export async function listRates(db: Database, tenantId: string, limit = 30): Promise<StoredRate[]> {
  const rows = await withTenant(db, tenantId, (tx) =>
    tx
      .select()
      .from(schema.exchangeRates)
      .where(eq(schema.exchangeRates.tenantId, tenantId))
      .orderBy(desc(schema.exchangeRates.effectiveOn))
      .limit(limit),
  )

  return rows.map((row) => ({ ...makeRate(row.bsPerUsd, row.effectiveOn, row.source), id: row.id }))
}
