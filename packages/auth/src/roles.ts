/**
 * Rol dentro de un negocio.
 *
 * Hay uno solo: el producto apunta a negocios pequeños donde una persona hace
 * todo, y lo que separa a un usuario de otro no es su rol sino su negocio —
 * eso ya lo hace cumplir Postgres con seguridad por fila.
 *
 * No hay matriz de permisos. Con un único rol, cualquier comprobación
 * devolvería siempre lo mismo: código muerto que habría que mantener y probar.
 * Cuando existan varios usuarios por negocio, la matriz se escribe entonces,
 * contra requisitos reales y no imaginados.
 */
export type MemberRole = 'OWNER'

export const DEFAULT_ROLE: MemberRole = 'OWNER'
