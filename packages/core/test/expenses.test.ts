import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { schema, withTenant, type Database } from '@fve/db'
import { usd, ves } from '@fve/money'

import { createExpense, expensesTotal, listExpenses, setRate } from '../src/index'
import { connect, resetDatabase, seedNegocio, type Negocio } from './helpers'

const HOY = '2026-08-28'
const AHORA = new Date('2026-08-28T12:00:00')
const TASA = '36,5842'

let db: Database
let close: () => Promise<void>
let negocio: Negocio

beforeAll(() => {
  const connection = connect()
  db = connection.db
  close = connection.close
})

afterAll(async () => {
  await close?.()
})

beforeEach(async () => {
  await resetDatabase(db)
  negocio = await seedNegocio(db)
  await setRate(db, { tenantId: negocio.tenantId, value: TASA, effectiveOn: HOY, userId: negocio.userId })
})

describe('gastos', () => {
  it('registra un gasto en las dos monedas y lo lista con su categoría', async () => {
    await createExpense(db, {
      tenantId: negocio.tenantId,
      userId: negocio.userId,
      categoryName: 'Alquiler',
      description: 'Alquiler del local',
      currency: 'VES',
      amount: ves(50000n), // Bs 500,00
      now: AHORA,
    })

    const lista = await listExpenses(db, { tenantId: negocio.tenantId })
    expect(lista).toHaveLength(1)
    expect(lista[0]?.category).toBe('Alquiler')
    expect(lista[0]?.amountVes.amount).toBe(50000n)

    const total = await expensesTotal(db, { tenantId: negocio.tenantId, from: HOY, to: HOY })
    expect(total.amount).toBe(50000n)
  })

  it('reutiliza la categoría por nombre en vez de duplicarla', async () => {
    const gasto = { tenantId: negocio.tenantId, userId: negocio.userId, categoryName: 'Servicios', description: 'x', currency: 'VES' as const, amount: ves(1000n), now: AHORA }
    await createExpense(db, gasto)
    await createExpense(db, { ...gasto, description: 'y' })

    const categorias = await withTenant(db, negocio.tenantId, (tx) =>
      tx.select().from(schema.expenseCategories),
    )
    expect(categorias).toHaveLength(1)
  })

  it('el total del período suma también los gastos en divisa a su tasa', async () => {
    await createExpense(db, {
      tenantId: negocio.tenantId,
      userId: negocio.userId,
      description: 'Compra de insumos en dólares',
      currency: 'USD',
      amount: usd(1000n), // $10,00 → Bs 365,84 a 36,5842
      now: AHORA,
    })

    const total = await expensesTotal(db, { tenantId: negocio.tenantId, from: HOY, to: HOY })
    expect(total.amount).toBe(36584n)
  })
})
