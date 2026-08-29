import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/** Bytes de entropía del token de sesión. 32 bytes son 256 bits. */
const TOKEN_BYTES = 32

/**
 * Genera un token de sesión.
 *
 * Se usa `randomBytes`, no `Math.random`: el segundo es predecible y adivinar un
 * token de sesión es entrar como otra persona.
 */
export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url')
}

/**
 * SHA-256 en hexadecimal del token.
 *
 * En la base solo vive este hash. El token en claro lo tiene únicamente el
 * cliente, de modo que una filtración de la base no entrega sesiones usables.
 *
 * No se usa argon2 aquí a propósito: un token de 256 bits aleatorios no es
 * adivinable por fuerza bruta, así que el coste extra solo serviría para
 * ralentizar cada petición.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Compara dos hashes en tiempo constante. */
export function tokenHashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}
