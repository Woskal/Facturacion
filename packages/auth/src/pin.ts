import { and, eq, isNull } from 'drizzle-orm'
import { schema, withTenant, type Database } from '@fve/db'

import { InvalidCredentialsError } from './errors'
import { hashPassword, verifyPassword, decoyHash } from './password'

/**
 * Credencial de desbloqueo de una caja.
 *
 * No es una identidad aparte: el correo y la contraseña siguen siendo la
 * credencial de registro. Esto solo permite reabrir rápido una sesión ya
 * autorizada en esa caja, y es lo que hace que la venta no se detenga cuando se
 * cae el internet.
 *
 * El PIN se guarda con argon2id igual que una contraseña. Es corto, así que el
 * coste del hash es lo único que lo separa de ser adivinable.
 */
export interface StationPinInput {
  readonly tenantId: string
  readonly userId: string
  readonly stationId: string
  readonly pin: string
}

/** Longitud mínima del PIN. Cuatro dígitos son 10.000 combinaciones. */
export const MIN_PIN_LENGTH = 4

export async function setStationPin(db: Database, input: StationPinInput): Promise<void> {
  if (input.pin.trim().length < MIN_PIN_LENGTH) {
    throw new InvalidCredentialsError()
  }
  const pinHash = await hashPassword(input.pin)

  await withTenant(db, input.tenantId, async (tx) => {
    await tx
      .insert(schema.stationCredentials)
      .values({
        tenantId: input.tenantId,
        userId: input.userId,
        stationId: input.stationId,
        pinHash,
      })
      .onConflictDoUpdate({
        target: [schema.stationCredentials.stationId, schema.stationCredentials.userId],
        set: { pinHash, revokedAt: null },
      })
  })
}

/**
 * Verifica el PIN de una caja.
 *
 * Una credencial revocada o inexistente igual paga el coste de una verificación
 * contra el hash señuelo, por la misma razón que en el login: si no, el tiempo
 * de respuesta revela qué usuarios están habilitados en esa caja.
 */
export async function verifyStationPin(db: Database, input: StationPinInput): Promise<boolean> {
  return withTenant(db, input.tenantId, async (tx) => {
    const rows = await tx
      .select()
      .from(schema.stationCredentials)
      .where(
        and(
          eq(schema.stationCredentials.stationId, input.stationId),
          eq(schema.stationCredentials.userId, input.userId),
          isNull(schema.stationCredentials.revokedAt),
        ),
      )
      .limit(1)

    const credential = rows[0]
    if (!credential) {
      await verifyPassword(await decoyHash(), input.pin)
      return false
    }

    return verifyPassword(credential.pinHash, input.pin)
  })
}

export async function revokeStationPin(
  db: Database,
  input: Omit<StationPinInput, 'pin'>,
  now: Date = new Date(),
): Promise<void> {
  await withTenant(db, input.tenantId, async (tx) => {
    await tx
      .update(schema.stationCredentials)
      .set({ revokedAt: now })
      .where(
        and(
          eq(schema.stationCredentials.stationId, input.stationId),
          eq(schema.stationCredentials.userId, input.userId),
        ),
      )
  })
}
