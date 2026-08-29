import { ForbiddenError } from './errors'

/** Rol dentro de un negocio. Coincide con el enum `member_role` del esquema. */
export type MemberRole = 'OWNER' | 'ADMIN' | 'CASHIER' | 'VIEWER'

/**
 * Acciones que el sistema controla.
 *
 * La lista es corta a propósito: un permiso por cada cosa que un dueño querría
 * poder negarle a alguien. Permisos que nadie va a configurar solo estorban.
 */
export const PERMISSIONS = [
  'sale:create',
  'sale:void',
  'cash:open',
  'cash:close',
  'customer:manage',
  'product:manage',
  'inventory:adjust',
  'expense:manage',
  'receivable:manage',
  'rate:manage',
  'report:view',
  'team:manage',
  'settings:manage',
] as const

export type Permission = (typeof PERMISSIONS)[number]

/**
 * Qué puede hacer cada rol.
 *
 * Dos decisiones que no son obvias y sí importan:
 *
 *  - **El cajero no puede anular ventas.** Anular la venta propia y quedarse con
 *    el efectivo es el fraude clásico del mostrador. Anular exige dueño o
 *    administrador.
 *  - **El cajero no ve reportes.** Vende y cuadra su caja; la utilidad del
 *    negocio no es asunto suyo.
 */
export const ROLE_PERMISSIONS: Readonly<Record<MemberRole, readonly Permission[]>> = Object.freeze({
  OWNER: PERMISSIONS,
  ADMIN: PERMISSIONS.filter((permission) => permission !== 'settings:manage'),
  CASHIER: ['sale:create', 'cash:open', 'cash:close', 'customer:manage'],
  VIEWER: ['report:view'],
})

export function can(role: MemberRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission)
}

/** Igual que `can`, pero lanza. Para usar en el borde de cada operación. */
export function authorize(role: MemberRole, permission: Permission): void {
  if (!can(role, permission)) {
    throw new ForbiddenError(permission)
  }
}
