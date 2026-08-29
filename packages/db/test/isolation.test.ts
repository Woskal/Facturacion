import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { withTenant, type Database } from '../src/client'
import * as schema from '../src/schema/index'
import { TENANT_SCOPED_TABLES } from '../src/tenancy'
import { connect, issueDocument, resetDatabase, seedTenant, type SeededTenant } from './helpers'

let db: Database
let close: () => Promise<void>
let alpha: SeededTenant
let beta: SeededTenant

beforeAll(async () => {
  const connection = connect()
  db = connection.db
  close = connection.close
  await resetDatabase(db)
  alpha = await seedTenant(db, '1')
  beta = await seedTenant(db, '2')
})

afterAll(async () => {
  await close?.()
})

describe('cobertura del aislamiento', () => {
  it('toda tabla con tenant_id está declarada como alcanzada', async () => {
    const rows = await db.execute<{ table_name: string }>(sql`
      SELECT table_name FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'tenant_id'
      ORDER BY table_name
    `)
    const actual = [...rows].map((row) => row.table_name).sort()
    expect(actual).toEqual([...TENANT_SCOPED_TABLES].sort())
  })

  it('todas tienen seguridad por fila activada y forzada', async () => {
    const rows = await db.execute<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(sql`
      SELECT relname, relrowsecurity, relforcerowsecurity
      FROM pg_class
      WHERE relname = ANY(${sql.raw(`ARRAY[${TENANT_SCOPED_TABLES.map((t) => `'${t}'`).join(',')}]`)})
    `)
    expect([...rows]).toHaveLength(TENANT_SCOPED_TABLES.length)
    for (const row of rows) {
      expect(row.relrowsecurity, `${row.relname} sin RLS`).toBe(true)
      // Sin FORCE, el dueño de la tabla —que es el rol de la aplicación— se
      // saltaría la política y el aislamiento sería decorativo.
      expect(row.relforcerowsecurity, `${row.relname} sin FORCE`).toBe(true)
    }
  })

  it('el rol de la aplicación no es superusuario', async () => {
    const rows = await db.execute<{ rolsuper: boolean }>(sql`
      SELECT rolsuper FROM pg_roles WHERE rolname = current_user
    `)
    // Un superusuario ignora toda política de seguridad por fila.
    expect([...rows][0]?.rolsuper).toBe(false)
  })
})

describe('un negocio no ve al otro', () => {
  it('cada uno solo ve sus productos', async () => {
    const desdeAlpha = await withTenant(db, alpha.tenantId, (tx) => tx.select().from(schema.products))
    const desdeBeta = await withTenant(db, beta.tenantId, (tx) => tx.select().from(schema.products))

    expect(desdeAlpha).toHaveLength(1)
    expect(desdeBeta).toHaveLength(1)
    expect(desdeAlpha[0]?.tenantId).toBe(alpha.tenantId)
    expect(desdeBeta[0]?.tenantId).toBe(beta.tenantId)
  })

  it('una consulta que olvida filtrar no devuelve datos ajenos: devuelve nada', async () => {
    // Consulta deliberadamente mal escrita, sin `where tenant_id = ...`.
    const rows = await withTenant(db, beta.tenantId, (tx) =>
      tx.select().from(schema.products).where(eq(schema.products.id, alpha.productId)),
    )
    expect(rows).toHaveLength(0)
  })

  it('no se puede leer un documento de otro negocio ni conociendo su id', async () => {
    const documentId = await issueDocument(db, alpha, 1)
    const rows = await withTenant(db, beta.tenantId, (tx) =>
      tx.select().from(schema.documents).where(eq(schema.documents.id, documentId)),
    )
    expect(rows).toHaveLength(0)
  })

  it('no se puede escribir una fila hacia otro negocio', async () => {
    await expect(
      withTenant(db, beta.tenantId, (tx) =>
        tx.insert(schema.customers).values({
          tenantId: alpha.tenantId, // apuntando al negocio ajeno
          idKind: 'V',
          idNumber: '12345678',
          name: 'Cliente infiltrado',
        }),
      ),
    ).rejects.toThrow()
  })

  it('no se puede mover una fila propia hacia otro negocio', async () => {
    await expect(
      withTenant(db, alpha.tenantId, (tx) =>
        tx
          .update(schema.products)
          .set({ tenantId: beta.tenantId })
          .where(eq(schema.products.id, alpha.productId)),
      ),
    ).rejects.toThrow()
  })

  it('sin negocio activo no se ve absolutamente nada', async () => {
    const rows = await db.select().from(schema.products)
    expect(rows).toHaveLength(0)
  })

  it('el contexto no se filtra fuera de su transacción', async () => {
    await withTenant(db, alpha.tenantId, async (tx) => {
      const visible = await tx.select().from(schema.products)
      expect(visible).toHaveLength(1)
    })
    // Terminada la transacción, `app.tenant_id` vuelve a estar vacío.
    const despues = await db.select().from(schema.products)
    expect(despues).toHaveLength(0)
  })
})

describe('un documento emitido es inmutable', () => {
  it('no admite modificaciones', async () => {
    const documentId = await issueDocument(db, alpha, 10)
    await expect(
      withTenant(db, alpha.tenantId, (tx) =>
        tx.update(schema.documents).set({ totalUsd: 999999n }).where(eq(schema.documents.id, documentId)),
      ),
    ).rejects.toThrow(/ya fue emitido/)
  })

  it('no se borra', async () => {
    const documentId = await issueDocument(db, alpha, 11)
    await expect(
      withTenant(db, alpha.tenantId, (tx) =>
        tx.delete(schema.documents).where(eq(schema.documents.id, documentId)),
      ),
    ).rejects.toThrow(/no se borra/)
  })

  it('se puede anular, conservando la fila y el consecutivo', async () => {
    const documentId = await issueDocument(db, alpha, 12)
    await withTenant(db, alpha.tenantId, (tx) =>
      tx
        .update(schema.documents)
        .set({ status: 'VOIDED', voidedAt: new Date(), voidReason: 'Error del cajero' })
        .where(eq(schema.documents.id, documentId)),
    )

    const rows = await withTenant(db, alpha.tenantId, (tx) =>
      tx.select().from(schema.documents).where(eq(schema.documents.id, documentId)),
    )
    expect(rows[0]?.status).toBe('VOIDED')
    expect(rows[0]?.fullNumber).toBe('NE-000012')
  })

  it('su detalle tampoco se puede tocar por la puerta de atrás', async () => {
    const documentId = await issueDocument(db, alpha, 13)
    await expect(
      withTenant(db, alpha.tenantId, (tx) =>
        tx.insert(schema.documentPayments).values({
          tenantId: alpha.tenantId,
          documentId,
          method: 'EFECTIVO_USD',
          currency: 'USD',
          amount: 10000n,
          amountUsd: 10000n,
          amountVes: 365842n,
          isDivisa: true,
        }),
      ),
    ).rejects.toThrow(/no admite cambios/)
  })

  it('un borrador sí se edita, hasta que se emite', async () => {
    const draftId = await withTenant(db, alpha.tenantId, async (tx) => {
      const [doc] = await tx
        .insert(schema.documents)
        .values({
          tenantId: alpha.tenantId,
          kind: 'PRESUPUESTO',
          seriesId: alpha.seriesId,
          number: 500,
          fullNumber: 'NE-000500',
          stationId: alpha.stationId,
          issuedByUserId: alpha.userId,
          status: 'DRAFT',
          currency: 'USD',
          exchangeRateId: alpha.exchangeRateId,
          rateBsPerUsd: 3658420000n,
          rateEffectiveOn: '2026-08-28',
        })
        .returning({ id: schema.documents.id })
      return doc?.id ?? ''
    })

    await withTenant(db, alpha.tenantId, (tx) =>
      tx.update(schema.documents).set({ notes: 'Ajustado antes de emitir' }).where(eq(schema.documents.id, draftId)),
    )

    const rows = await withTenant(db, alpha.tenantId, (tx) =>
      tx.select().from(schema.documents).where(eq(schema.documents.id, draftId)),
    )
    expect(rows[0]?.notes).toBe('Ajustado antes de emitir')
  })
})

describe('el consecutivo no se duplica', () => {
  it('dos documentos no pueden compartir número dentro de una serie', async () => {
    await issueDocument(db, alpha, 20)
    await expect(issueDocument(db, alpha, 20)).rejects.toThrow()
  })

  it('cada negocio lleva su propia numeración', async () => {
    await issueDocument(db, alpha, 30)
    await expect(issueDocument(db, beta, 30)).resolves.toBeTruthy()
  })
})
