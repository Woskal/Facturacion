/**
 * @fve/auth — autenticación, sesiones y permisos.
 *
 * Decisiones que sostienen el resto:
 *
 *  1. Contraseñas y PIN con argon2id. El coste es deliberado: una función de
 *     hash rápida convierte una filtración en un desastre.
 *  2. Sesiones opacas en base de datos. Se revocan al instante — se despide a un
 *     cajero y pierde el acceso en la siguiente petición, no cuando expire nada.
 *  3. El token de sesión nunca se guarda en claro: solo su SHA-256.
 *  4. Correo inexistente y contraseña incorrecta devuelven el mismo error y
 *     tardan lo mismo. La diferencia sería un oráculo de qué cuentas existen.
 *  5. La membresía se valida contra la base en cada cambio de negocio, nunca
 *     contra lo que diga el cliente.
 */

export * from './errors'
export * from './password'
export * from './token'
export * from './access'
export * from './sessions'
export * from './login'
export * from './pin'
