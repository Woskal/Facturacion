/**
 * Errores del núcleo monetario.
 *
 * Todos heredan de `MoneyError` para que la capa de aplicación pueda distinguir
 * un fallo de dominio monetario de cualquier otro error.
 */
export class MoneyError extends Error {
  override readonly name: string = 'MoneyError'
}

/** Se intentó operar dos montos de monedas distintas sin convertir. */
export class CurrencyMismatchError extends MoneyError {
  override readonly name = 'CurrencyMismatchError'
  constructor(
    readonly left: string,
    readonly right: string,
  ) {
    super(`No se pueden operar montos de monedas distintas: ${left} y ${right}. Convierta primero con una tasa.`)
  }
}

/** Un valor no representa un monto válido (NaN, decimales de más, formato inválido). */
export class InvalidAmountError extends MoneyError {
  override readonly name = 'InvalidAmountError'
}

/** Una tasa es inválida (cero, negativa o mal formada). */
export class InvalidRateError extends MoneyError {
  override readonly name = 'InvalidRateError'
}

/** Un cálculo de impuesto recibió parámetros inválidos. */
export class InvalidTaxError extends MoneyError {
  override readonly name = 'InvalidTaxError'
}

/** Un pago es inconsistente (moneda que no corresponde al medio, referencia faltante, etc.). */
export class InvalidPaymentError extends MoneyError {
  override readonly name = 'InvalidPaymentError'
}
