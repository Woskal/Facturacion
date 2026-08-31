/** Errores de las operaciones de negocio. */
export class CoreError extends Error {
  override readonly name: string = 'CoreError'
}

/** No hay tasa cargada para la fecha en que se quiere operar. */
export class MissingRateError extends CoreError {
  override readonly name = 'MissingRateError'
  constructor(readonly date: string) {
    super(
      `No hay tasa de cambio cargada para el ${date}. Cargue la tasa del día antes de vender: sin ella no se puede emitir nada.`,
    )
  }
}

/** No existe una serie activa para el tipo de documento pedido. */
export class MissingSeriesError extends CoreError {
  override readonly name = 'MissingSeriesError'
  constructor(readonly kind: string) {
    super(`No hay una serie de numeración activa para ${kind}.`)
  }
}

/** Un producto no existe, está archivado o no tiene precio en la lista vigente. */
export class ProductUnavailableError extends CoreError {
  override readonly name = 'ProductUnavailableError'
}

/** La venta no quedó cubierta por los pagos. */
export class UnsettledSaleError extends CoreError {
  override readonly name = 'UnsettledSaleError'
  constructor(readonly pending: string) {
    super(`La venta quedó con un saldo pendiente de ${pending}. Complete el pago o registre el resto a crédito.`)
  }
}

/** Se intentó vender a crédito sin cliente identificado. */
export class CreditRequiresCustomerError extends CoreError {
  override readonly name = 'CreditRequiresCustomerError'
  constructor() {
    super('Una venta a crédito exige identificar al cliente: si no, no hay a quién cobrarle.')
  }
}

/** La venta no tiene líneas. */
export class EmptySaleError extends CoreError {
  override readonly name = 'EmptySaleError'
  constructor() {
    super('No se puede emitir un documento sin líneas.')
  }
}

/** El documento no existe dentro del negocio activo. */
export class DocumentNotFoundError extends CoreError {
  override readonly name = 'DocumentNotFoundError'
  constructor(readonly documentId: string) {
    super('El documento no existe.')
  }
}

/** Se intentó anular algo que no está emitido. */
export class NotVoidableError extends CoreError {
  override readonly name = 'NotVoidableError'
  constructor(readonly status: string) {
    super(`Solo se puede anular un documento emitido; este está en ${status}.`)
  }
}

/** Se intentó acreditar un documento que no admite nota de crédito. */
export class NotCreditableError extends CoreError {
  override readonly name = 'NotCreditableError'
  constructor(readonly reason: string) {
    super(reason)
  }
}

/** El documento ya tiene una nota de crédito emitida. */
export class AlreadyCreditedError extends CoreError {
  override readonly name = 'AlreadyCreditedError'
  constructor() {
    super('Este documento ya tiene una nota de crédito.')
  }
}
