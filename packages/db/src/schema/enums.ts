import { pgEnum } from 'drizzle-orm/pg-core'

/**
 * Enumeraciones del dominio.
 *
 * Los identificadores están en inglés salvo los términos fiscales venezolanos
 * que no tienen equivalente útil — alícuota, IGTF, RIF, los nombres de los
 * documentos. Es la misma convención de `@fve/money`.
 */

export const currency = pgEnum('currency', ['VES', 'USD'])

export const rateSource = pgEnum('rate_source', ['BCV', 'MANUAL', 'PARALELO'])

/** Letra del documento de identidad o RIF: V-, E-, J-, G-, P-. */
export const idKind = pgEnum('id_kind', ['V', 'E', 'J', 'G', 'P'])

/**
 * Rol dentro de un negocio.
 *
 * Un solo valor a propósito: el producto apunta a negocios pequeños donde una
 * persona hace todo. Una matriz de permisos con roles que nadie usa es
 * maquinaria muerta que igual hay que mantener y probar.
 *
 * La columna se conserva —en vez de eliminarse— porque es la costura por donde
 * entrarán más roles el día que haya varios usuarios por negocio. Agregar
 * valores a un enum de Postgres es barato; volver a introducir la columna
 * después, no.
 */
export const memberRole = pgEnum('member_role', ['OWNER'])

/** Si el precio de catálogo trae el IVA adentro o se agrega al facturar. */
export const priceMode = pgEnum('price_mode', ['IVA_INCLUIDO', 'IVA_EXCLUIDO'])

/**
 * Documentos que emite el sistema.
 *
 * Ninguno es un documento fiscal: la factura la produce la máquina fiscal o la
 * imprenta autorizada del cliente. Los nombres se dejan en español porque son
 * los términos con los que el usuario los pide.
 */
export const documentKind = pgEnum('document_kind', [
  'PRESUPUESTO',
  'NOTA_ENTREGA',
  'RECIBO',
  'NOTA_CREDITO',
])

/**
 * Un documento emitido es inmutable. No se edita: se anula y se emite una nota
 * de crédito. `VOIDED` conserva la fila y el consecutivo, nunca borra.
 */
export const documentStatus = pgEnum('document_status', ['DRAFT', 'ISSUED', 'VOIDED'])

export const paymentMethod = pgEnum('payment_method', [
  'EFECTIVO_BS',
  'EFECTIVO_USD',
  'PAGO_MOVIL',
  'TRANSFERENCIA_BS',
  'PUNTO_VENTA',
  'ZELLE',
  'USDT',
  'CREDITO',
])

export const stockMovementKind = pgEnum('stock_movement_kind', [
  'INITIAL',
  'SALE',
  'PURCHASE',
  'RETURN',
  'ADJUSTMENT',
])

/**
 * Formas en que se salda una cuenta por cobrar.
 *
 * Las retenciones están aquí desde el día uno aunque el módulo de retenciones
 * no exista todavía: un contribuyente especial retiene el 75% o el 100% del IVA
 * al pagar, y si la cartera no admite ese abono nunca cuadra. Agregarlo después
 * obligaría a migrar cobros ya registrados.
 */
export const receivableEntryKind = pgEnum('receivable_entry_kind', [
  'PAYMENT',
  'RETENTION_IVA',
  'RETENTION_ISLR',
  'CREDIT_NOTE',
  'WRITE_OFF',
])

export const auditAction = pgEnum('audit_action', ['CREATE', 'UPDATE', 'ISSUE', 'VOID', 'DELETE', 'LOGIN'])
