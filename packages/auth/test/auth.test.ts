import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { schema, withTenant, type Database } from '@fve/db'

import {
  AccountLockedError,
  DEFAULT_SESSION_TTL_MS,
  ForbiddenError,
  InvalidCredentialsError,
  InvalidSessionError,
  MAX_FAILED_ATTEMPTS,
  MembershipRequiredError,
  ROLE_PERMISSIONS,
  authenticate,
  authorize,
  can,
  changePassword,
  generateToken,
  hashPassword,
  hashToken,
  issueSession,
  listMemberships,
  revokeSession,
  revokeSessionsForMembership,
  revokeStationPin,
  selectTenant,
  setStationPin,
  verifyPassword,
  verifySession,
  verifyStationPin,
} from '../src/index'
import { CLAVE, addMembership, connect, createStation, createTenant, createUser, resetDatabase } from './helpers'

let db: Database
let close: () => Promise<void>

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
})

describe('contraseñas', () => {
  it('verifica la correcta y rechaza la incorrecta', async () => {
    const hash = await hashPassword(CLAVE)
    expect(await verifyPassword(hash, CLAVE)).toBe(true)
    expect(await verifyPassword(hash, 'otra-cosa')).toBe(false)
  })

  it('produce un hash distinto cada vez, por la sal', async () => {
    expect(await hashPassword(CLAVE)).not.toBe(await hashPassword(CLAVE))
  })

  it('un hash corrupto no revienta, simplemente no coincide', async () => {
    expect(await verifyPassword('esto-no-es-un-hash', CLAVE)).toBe(false)
  })

  it('nunca guarda la contraseña en claro', async () => {
    const hash = await hashPassword(CLAVE)
    expect(hash).not.toContain(CLAVE)
    expect(hash.startsWith('$argon2id$')).toBe(true)
  })
})

describe('tokens de sesión', () => {
  it('son distintos y de suficiente entropía', () => {
    const uno = generateToken()
    const dos = generateToken()
    expect(uno).not.toBe(dos)
    expect(Buffer.from(uno, 'base64url')).toHaveLength(32)
  })

  it('en la base solo vive el hash, nunca el token', async () => {
    const userId = await createUser(db, 'a@ejemplo.ve')
    const { token, sessionId } = await issueSession(db, { userId })

    const rows = await db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId))
    expect(rows[0]?.tokenHash).toBe(hashToken(token))
    expect(rows[0]?.tokenHash).not.toBe(token)
  })
})

describe('autenticación', () => {
  it('acepta credenciales válidas y abre sesión', async () => {
    await createUser(db, 'duenio@ejemplo.ve', 'Dueño')
    const result = await authenticate(db, { email: 'duenio@ejemplo.ve', password: CLAVE })

    expect(result.fullName).toBe('Dueño')
    expect(result.session.token).toBeTruthy()
    expect(result.session.expiresAt.getTime()).toBeGreaterThan(Date.now())
  })

  it('normaliza el correo: mayúsculas y espacios no impiden entrar', async () => {
    await createUser(db, 'duenio@ejemplo.ve')
    await expect(authenticate(db, { email: '  DUENIO@Ejemplo.VE  ', password: CLAVE })).resolves.toBeTruthy()
  })

  it('rechaza la contraseña incorrecta', async () => {
    await createUser(db, 'duenio@ejemplo.ve')
    await expect(authenticate(db, { email: 'duenio@ejemplo.ve', password: 'mala' })).rejects.toThrow(
      InvalidCredentialsError,
    )
  })

  it('un correo inexistente da el mismo error, sin delatar que no existe', async () => {
    await createUser(db, 'duenio@ejemplo.ve')

    const inexistente = await authenticate(db, { email: 'nadie@ejemplo.ve', password: CLAVE }).catch((e) => e)
    const claveMala = await authenticate(db, { email: 'duenio@ejemplo.ve', password: 'mala' }).catch((e) => e)

    expect(inexistente).toBeInstanceOf(InvalidCredentialsError)
    expect(claveMala).toBeInstanceOf(InvalidCredentialsError)
    expect(inexistente.message).toBe(claveMala.message)
  })

  it('el correo inexistente tampoco se delata por el tiempo de respuesta', async () => {
    await createUser(db, 'duenio@ejemplo.ve')

    const medir = async (email: string) => {
      const inicio = process.hrtime.bigint()
      await authenticate(db, { email, password: 'mala' }).catch(() => undefined)
      return Number(process.hrtime.bigint() - inicio) / 1e6
    }

    // Se descarta la primera medición: incluye calcular el hash señuelo una vez.
    await medir('nadie@ejemplo.ve')

    const existente = await medir('duenio@ejemplo.ve')
    const inexistente = await medir('nadie@ejemplo.ve')

    // Ambos pagan una verificación argon2 completa. Sin el señuelo, el
    // inexistente respondería en microsegundos y sería un oráculo de cuentas.
    expect(inexistente).toBeGreaterThan(existente * 0.35)
  })

  it('bloquea la cuenta tras demasiados intentos fallidos', async () => {
    await createUser(db, 'duenio@ejemplo.ve')

    for (let intento = 0; intento < MAX_FAILED_ATTEMPTS; intento += 1) {
      await authenticate(db, { email: 'duenio@ejemplo.ve', password: 'mala' }).catch(() => undefined)
    }

    // Con la contraseña correcta tampoco entra: la cuenta quedó bloqueada.
    await expect(authenticate(db, { email: 'duenio@ejemplo.ve', password: CLAVE })).rejects.toThrow(
      AccountLockedError,
    )
  })

  it('el contador se reinicia con un ingreso correcto', async () => {
    const userId = await createUser(db, 'duenio@ejemplo.ve')
    await authenticate(db, { email: 'duenio@ejemplo.ve', password: 'mala' }).catch(() => undefined)
    await authenticate(db, { email: 'duenio@ejemplo.ve', password: CLAVE })

    const rows = await db.select().from(schema.users).where(eq(schema.users.id, userId))
    expect(rows[0]?.failedAttempts).toBe(0)
  })

  it('una cuenta archivada no puede entrar', async () => {
    const userId = await createUser(db, 'exempleado@ejemplo.ve')
    await db.update(schema.users).set({ archivedAt: new Date() }).where(eq(schema.users.id, userId))

    await expect(authenticate(db, { email: 'exempleado@ejemplo.ve', password: CLAVE })).rejects.toThrow(
      InvalidCredentialsError,
    )
  })
})

describe('sesiones', () => {
  it('valida una sesión viva', async () => {
    const userId = await createUser(db, 'a@ejemplo.ve')
    const { token, sessionId } = await issueSession(db, { userId })

    const active = await verifySession(db, token)
    expect(active.sessionId).toBe(sessionId)
    expect(active.userId).toBe(userId)
    expect(active.activeTenantId).toBeNull()
  })

  it('rechaza un token inventado', async () => {
    await expect(verifySession(db, generateToken())).rejects.toThrow(InvalidSessionError)
  })

  it('rechaza una sesión expirada', async () => {
    const userId = await createUser(db, 'a@ejemplo.ve')
    const { token } = await issueSession(db, { userId, ttlMs: 1000 })

    const futuro = new Date(Date.now() + DEFAULT_SESSION_TTL_MS)
    await expect(verifySession(db, token, futuro)).rejects.toThrow(InvalidSessionError)
  })

  it('rechaza una sesión revocada de inmediato', async () => {
    const userId = await createUser(db, 'cajero@ejemplo.ve')
    const { token, sessionId } = await issueSession(db, { userId })

    await expect(verifySession(db, token)).resolves.toBeTruthy()
    await revokeSession(db, sessionId)
    // Sin esperar a que expire: se despide al cajero y pierde el acceso ya.
    await expect(verifySession(db, token)).rejects.toThrow(InvalidSessionError)
  })

  it('expirada, revocada e inexistente son indistinguibles para el cliente', async () => {
    const userId = await createUser(db, 'a@ejemplo.ve')
    const { token: revocado, sessionId } = await issueSession(db, { userId })
    await revokeSession(db, sessionId)
    const { token: vencido } = await issueSession(db, { userId, ttlMs: 1 })
    const futuro = new Date(Date.now() + 60_000)

    const errores = await Promise.all([
      verifySession(db, revocado).catch((e) => e.message),
      verifySession(db, vencido, futuro).catch((e) => e.message),
      verifySession(db, generateToken()).catch((e) => e.message),
    ])
    expect(new Set(errores).size).toBe(1)
  })
})

describe('selección de negocio', () => {
  it('abre el negocio del que se es miembro', async () => {
    const userId = await createUser(db, 'duenio@ejemplo.ve')
    const tenantId = await createTenant(db, '1')
    await addMembership(db, tenantId, userId, 'OWNER')

    const { session } = await authenticate(db, { email: 'duenio@ejemplo.ve', password: CLAVE })
    const selected = await selectTenant(db, session.sessionId, tenantId)

    expect(selected.tenantId).toBe(tenantId)
    expect(selected.role).toBe('OWNER')
    expect((await verifySession(db, session.token)).activeTenantId).toBe(tenantId)
  })

  it('EL TEST QUE IMPORTA: no se puede abrir un negocio ajeno ni pasando su id a mano', async () => {
    const userId = await createUser(db, 'ajeno@ejemplo.ve')
    const propio = await createTenant(db, '1')
    const ajeno = await createTenant(db, '2')
    await addMembership(db, propio, userId, 'OWNER')

    const { session } = await authenticate(db, { email: 'ajeno@ejemplo.ve', password: CLAVE })

    await expect(selectTenant(db, session.sessionId, ajeno)).rejects.toThrow(MembershipRequiredError)

    // Y la sesión sigue sin negocio activo: el intento fallido no dejó rastro.
    expect((await verifySession(db, session.token)).activeTenantId).toBeNull()
  })

  it('la sesión nace sin negocio activo aunque solo haya uno', async () => {
    const userId = await createUser(db, 'duenio@ejemplo.ve')
    const tenantId = await createTenant(db, '1')
    await addMembership(db, tenantId, userId, 'OWNER')

    const { session, memberships } = await authenticate(db, { email: 'duenio@ejemplo.ve', password: CLAVE })
    expect(memberships).toHaveLength(1)
    expect((await verifySession(db, session.token)).activeTenantId).toBeNull()
  })

  it('un contador con varios negocios los ve todos y cambia entre ellos', async () => {
    const userId = await createUser(db, 'contador@ejemplo.ve')
    const uno = await createTenant(db, '1')
    const dos = await createTenant(db, '2')
    await addMembership(db, uno, userId, 'ADMIN')
    await addMembership(db, dos, userId, 'VIEWER')

    const { session, memberships } = await authenticate(db, { email: 'contador@ejemplo.ve', password: CLAVE })
    expect(memberships).toHaveLength(2)

    expect((await selectTenant(db, session.sessionId, uno)).role).toBe('ADMIN')
    expect((await selectTenant(db, session.sessionId, dos)).role).toBe('VIEWER')
  })

  it('listMemberships solo devuelve las del usuario pedido, pese a ser SECURITY DEFINER', async () => {
    const uno = await createUser(db, 'uno@ejemplo.ve')
    const dos = await createUser(db, 'dos@ejemplo.ve')
    const tenantUno = await createTenant(db, '1')
    const tenantDos = await createTenant(db, '2')
    await addMembership(db, tenantUno, uno)
    await addMembership(db, tenantDos, dos)

    const deUno = await listMemberships(db, uno)
    expect(deUno).toHaveLength(1)
    expect(deUno[0]?.tenantId).toBe(tenantUno)
  })
})

describe('revocación en cascada', () => {
  it('cambiar la contraseña cierra las demás sesiones y conserva la actual', async () => {
    await createUser(db, 'duenio@ejemplo.ve')
    const vieja = await authenticate(db, { email: 'duenio@ejemplo.ve', password: CLAVE })
    const actual = await authenticate(db, { email: 'duenio@ejemplo.ve', password: CLAVE })

    await changePassword(db, {
      userId: actual.userId,
      currentPassword: CLAVE,
      newPassword: 'otra-clave-igual-de-larga',
      keepSessionId: actual.session.sessionId,
    })

    await expect(verifySession(db, vieja.session.token)).rejects.toThrow(InvalidSessionError)
    await expect(verifySession(db, actual.session.token)).resolves.toBeTruthy()
    await expect(
      authenticate(db, { email: 'duenio@ejemplo.ve', password: 'otra-clave-igual-de-larga' }),
    ).resolves.toBeTruthy()
  })

  it('la contraseña actual incorrecta no permite cambiarla', async () => {
    const userId = await createUser(db, 'duenio@ejemplo.ve')
    await expect(
      changePassword(db, { userId, currentPassword: 'mala', newPassword: 'da-igual-cual-sea' }),
    ).rejects.toThrow(InvalidCredentialsError)
  })

  it('retirar a alguien de un negocio cierra sus sesiones en ese negocio', async () => {
    const userId = await createUser(db, 'cajero@ejemplo.ve')
    const tenantId = await createTenant(db, '1')
    await addMembership(db, tenantId, userId, 'CASHIER')

    const { session } = await authenticate(db, { email: 'cajero@ejemplo.ve', password: CLAVE })
    await selectTenant(db, session.sessionId, tenantId)

    await withTenant(db, tenantId, (tx) =>
      tx.delete(schema.memberships).where(eq(schema.memberships.userId, userId)),
    )
    const cerradas = await revokeSessionsForMembership(db, userId, tenantId)

    expect(cerradas).toBe(1)
    await expect(verifySession(db, session.token)).rejects.toThrow(InvalidSessionError)
  })
})

describe('permisos por rol', () => {
  it('el dueño puede todo', () => {
    expect(can('OWNER', 'settings:manage')).toBe(true)
    expect(can('OWNER', 'sale:void')).toBe(true)
  })

  it('el cajero no puede anular ventas: es el fraude clásico del mostrador', () => {
    expect(can('CASHIER', 'sale:create')).toBe(true)
    expect(can('CASHIER', 'sale:void')).toBe(false)
    expect(() => authorize('CASHIER', 'sale:void')).toThrow(ForbiddenError)
  })

  it('el cajero no ve reportes ni toca el catálogo', () => {
    expect(can('CASHIER', 'report:view')).toBe(false)
    expect(can('CASHIER', 'product:manage')).toBe(false)
    expect(can('CASHIER', 'rate:manage')).toBe(false)
  })

  it('el administrador puede todo salvo la configuración del negocio', () => {
    expect(can('ADMIN', 'sale:void')).toBe(true)
    expect(can('ADMIN', 'team:manage')).toBe(true)
    expect(can('ADMIN', 'settings:manage')).toBe(false)
  })

  it('el observador solo mira', () => {
    expect(ROLE_PERMISSIONS.VIEWER).toEqual(['report:view'])
    expect(can('VIEWER', 'sale:create')).toBe(false)
  })
})

describe('PIN de estación para operar sin conexión', () => {
  it('acepta el PIN correcto y rechaza el errado', async () => {
    const userId = await createUser(db, 'cajero@ejemplo.ve')
    const tenantId = await createTenant(db, '1')
    await addMembership(db, tenantId, userId, 'CASHIER')
    const stationId = await createStation(db, tenantId)

    await setStationPin(db, { tenantId, userId, stationId, pin: '4821' })

    expect(await verifyStationPin(db, { tenantId, userId, stationId, pin: '4821' })).toBe(true)
    expect(await verifyStationPin(db, { tenantId, userId, stationId, pin: '0000' })).toBe(false)
  })

  it('guarda el PIN con argon2, nunca en claro', async () => {
    const userId = await createUser(db, 'cajero@ejemplo.ve')
    const tenantId = await createTenant(db, '1')
    await addMembership(db, tenantId, userId, 'CASHIER')
    const stationId = await createStation(db, tenantId)
    await setStationPin(db, { tenantId, userId, stationId, pin: '4821' })

    const rows = await withTenant(db, tenantId, (tx) => tx.select().from(schema.stationCredentials))
    expect(rows[0]?.pinHash).not.toContain('4821')
    expect(rows[0]?.pinHash.startsWith('$argon2id$')).toBe(true)
  })

  it('rechaza PIN demasiado cortos', async () => {
    const userId = await createUser(db, 'cajero@ejemplo.ve')
    const tenantId = await createTenant(db, '1')
    await addMembership(db, tenantId, userId, 'CASHIER')
    const stationId = await createStation(db, tenantId)

    await expect(setStationPin(db, { tenantId, userId, stationId, pin: '12' })).rejects.toThrow(
      InvalidCredentialsError,
    )
  })

  it('revocado deja de servir', async () => {
    const userId = await createUser(db, 'cajero@ejemplo.ve')
    const tenantId = await createTenant(db, '1')
    await addMembership(db, tenantId, userId, 'CASHIER')
    const stationId = await createStation(db, tenantId)
    await setStationPin(db, { tenantId, userId, stationId, pin: '4821' })

    await revokeStationPin(db, { tenantId, userId, stationId })
    expect(await verifyStationPin(db, { tenantId, userId, stationId, pin: '4821' })).toBe(false)
  })

  it('reasignar el PIN reactiva la credencial revocada', async () => {
    const userId = await createUser(db, 'cajero@ejemplo.ve')
    const tenantId = await createTenant(db, '1')
    await addMembership(db, tenantId, userId, 'CASHIER')
    const stationId = await createStation(db, tenantId)

    await setStationPin(db, { tenantId, userId, stationId, pin: '4821' })
    await revokeStationPin(db, { tenantId, userId, stationId })
    await setStationPin(db, { tenantId, userId, stationId, pin: '9137' })

    expect(await verifyStationPin(db, { tenantId, userId, stationId, pin: '9137' })).toBe(true)
    expect(await verifyStationPin(db, { tenantId, userId, stationId, pin: '4821' })).toBe(false)
  })

  it('el PIN de una caja no sirve en la caja de otro negocio', async () => {
    const userId = await createUser(db, 'cajero@ejemplo.ve')
    const propio = await createTenant(db, '1')
    const ajeno = await createTenant(db, '2')
    await addMembership(db, propio, userId, 'CASHIER')
    const stationPropia = await createStation(db, propio)
    const stationAjena = await createStation(db, ajeno)

    await setStationPin(db, { tenantId: propio, userId, stationId: stationPropia, pin: '4821' })

    expect(await verifyStationPin(db, { tenantId: ajeno, userId, stationId: stationAjena, pin: '4821' })).toBe(
      false,
    )
  })
})
