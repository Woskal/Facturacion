/** Errores de autenticación y autorización. */
export class AuthError extends Error {
  override readonly name: string = 'AuthError'
}

/**
 * Credenciales inválidas.
 *
 * Es el MISMO error para correo inexistente y para contraseña incorrecta, con el
 * mismo mensaje. Distinguirlos le diría a un atacante qué correos están
 * registrados, que es la mitad del trabajo de entrar.
 */
export class InvalidCredentialsError extends AuthError {
  override readonly name = 'InvalidCredentialsError'
  constructor() {
    super('Correo o contraseña incorrectos.')
  }
}

/** La cuenta quedó bloqueada temporalmente por intentos fallidos. */
export class AccountLockedError extends AuthError {
  override readonly name = 'AccountLockedError'
  constructor(readonly until: Date) {
    super('La cuenta está bloqueada temporalmente por intentos fallidos. Intente más tarde.')
  }
}

/** La sesión no existe, expiró o fue revocada. */
export class InvalidSessionError extends AuthError {
  override readonly name = 'InvalidSessionError'
  constructor(message = 'La sesión no es válida. Inicie sesión de nuevo.') {
    super(message)
  }
}

/** El usuario no pertenece al negocio que intenta usar. */
export class MembershipRequiredError extends AuthError {
  override readonly name = 'MembershipRequiredError'
  constructor() {
    super('No tiene acceso a este negocio.')
  }
}
