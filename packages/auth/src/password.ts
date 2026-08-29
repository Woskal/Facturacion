import { hash, verify } from '@node-rs/argon2'

/**
 * Parámetros de argon2id según la recomendación vigente de OWASP: 19 MiB de
 * memoria, dos iteraciones, un hilo.
 *
 * El coste es deliberado. Una función de hash rápida es exactamente lo que
 * convierte una filtración de la base en un desastre.
 */
const OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTIONS)
}

export async function verifyPassword(storedHash: string, plain: string): Promise<boolean> {
  try {
    return await verify(storedHash, plain, OPTIONS)
  } catch {
    // Un hash corrupto o de otro algoritmo no es una excepción del dominio:
    // simplemente no coincide.
    return false
  }
}

let decoy: Promise<string> | undefined

/**
 * Hash señuelo contra el que se verifica cuando el correo no existe.
 *
 * Sin esto, un correo desconocido responde de inmediato y uno registrado tarda
 * lo que tarda argon2. Esa diferencia de tiempo es un oráculo que revela qué
 * cuentas existen, por más que el mensaje de error sea idéntico.
 */
export function decoyHash(): Promise<string> {
  decoy ??= hashPassword('contrasena-señuelo-que-nunca-coincide')
  return decoy
}
