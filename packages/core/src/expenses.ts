import { and, eq, sql } from 'drizzle-orm'
import { schema, withTenant, type Database } from '@fve/db'
import { convert, money, type Currency, type Money } from '@fve/money'

import type { IsoDate } from './rates'
import { getRateFor, toIsoDate } from './rates'

/**
 * Gastos del negocio.
 *
 * Un gasto se guarda en las dos monedas con la tasa del día, igual que todo lo
 * demás, para que un reporte del mes pasado no cambie con la tasa de hoy. La
 * categoría es texto libre que se reutiliza: si el nombre ya existe se enlaza, y
 * si no, se crea. Así el dueño no administra un catálogo de categorías aparte.
 */

export interface CreateExpenseInput {
  readonly tenantId: string
  readonly userId: string
  readonly categoryName?: string | undefined
  readonly description: string
  readonly currency: Currency
  readonly amount: Money
  readonly paidWith?: string | undefined
  readonly reference?: string | undefined
  readonly now?: Date | undefined
}

export async function createExpense(db: Database, input: CreateExpenseInput): Promise<{ expenseId: string }> {
  const now = input.now ?? new Date()
  const rate = await getRateFor(db, input.tenantId, toIsoDate(now))

  return withTenant(db, input.tenantId, async (tx) => {
    let categoryId: string | null = null
    const nombre = input.categoryName?.trim()
    if (nombre) {
      const existing = await tx
        .select({ id: schema.expenseCategories.id })
        .from(schema.expenseCategories)
        .where(and(eq(schema.expenseCategories.tenantId, input.tenantId), eq(schema.expenseCategories.name, nombre)))
        .limit(1)

      if (existing[0]) {
        categoryId = existing[0].id
      } else {
        const [creada] = await tx
          .insert(schema.expenseCategories)
          .values({ tenantId: input.tenantId, name: nombre })
          .returning({ id: schema.expenseCategories.id })
        categoryId = creada?.id ?? null
      }
    }

    const [expense] = await tx
      .insert(schema.expenses)
      .values({
        tenantId: input.tenantId,
        categoryId,
        description: input.description,
        currency: input.currency,
        amount: input.amount.amount,
        amountUsd: convert(input.amount, 'USD', rate).amount,
        amountVes: convert(input.amount, 'VES', rate).amount,
        exchangeRateId: rate.id,
        rateBsPerUsd: rate.bsPerUsd,
        paidWith: (input.paidWith as never) ?? null,
        reference: input.reference ?? null,
        occurredAt: now,
        createdByUserId: input.userId,
      })
      .returning({ id: schema.expenses.id })

    if (!expense) throw new Error('No se pudo registrar el gasto.')

    await tx.insert(schema.auditLog).values({
      tenantId: input.tenantId,
      actorUserId: input.userId,
      action: 'CREATE',
      entity: 'expenses',
      entityId: expense.id,
      after: { description: input.description, amount: input.amount.amount.toString() },
      occurredAt: now,
    })

    return { expenseId: expense.id }
  })
}

export interface ExpenseView {
  readonly expenseId: string
  readonly category: string | null
  readonly description: string
  readonly currency: Currency
  readonly amount: Money
  readonly amountVes: Money
  readonly paidWith: string | null
  readonly occurredAt: Date
}

/** Gastos del período, del más reciente al más antiguo. */
export async function listExpenses(
  db: Database,
  input: { tenantId: string; from?: IsoDate | undefined; to?: IsoDate | undefined; limit?: number | undefined },
): Promise<ExpenseView[]> {
  const rows = await withTenant(db, input.tenantId, (tx) =>
    tx.execute<{
      id: string
      category: string | null
      description: string
      currency: Currency
      amount: string
      amount_ves: string
      paid_with: string | null
      occurred_at: string
    }>(sql`
      SELECT e.id, c.name AS category, e.description, e.currency,
             e.amount::text AS amount, e.amount_ves::text AS amount_ves,
             e.paid_with::text AS paid_with, e.occurred_at
      FROM expenses e
      LEFT JOIN expense_categories c ON c.id = e.category_id
      WHERE (${input.from ?? null}::date IS NULL
             OR (e.occurred_at AT TIME ZONE 'America/Caracas')::date >= ${input.from ?? null}::date)
        AND (${input.to ?? null}::date IS NULL
             OR (e.occurred_at AT TIME ZONE 'America/Caracas')::date <= ${input.to ?? null}::date)
      ORDER BY e.occurred_at DESC
      LIMIT ${input.limit ?? 200}
    `),
  )

  return [...rows].map((row) => ({
    expenseId: row.id,
    category: row.category,
    description: row.description,
    currency: row.currency,
    amount: money(row.currency, BigInt(row.amount)),
    amountVes: money('VES', BigInt(row.amount_ves)),
    paidWith: row.paid_with,
    occurredAt: new Date(row.occurred_at),
  }))
}

/** Total gastado en el período, en bolívares a la tasa de cada gasto. */
export async function expensesTotal(
  db: Database,
  input: { tenantId: string; from: IsoDate; to: IsoDate },
): Promise<Money> {
  const rows = await withTenant(db, input.tenantId, (tx) =>
    tx.execute<{ total: string }>(sql`
      SELECT COALESCE(SUM(amount_ves), 0)::text AS total
      FROM expenses
      WHERE (occurred_at AT TIME ZONE 'America/Caracas')::date BETWEEN ${input.from}::date AND ${input.to}::date
    `),
  )
  return money('VES', BigInt([...rows][0]?.total ?? '0'))
}
