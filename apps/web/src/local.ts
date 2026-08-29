import Dexie, { type EntityTable } from 'dexie'

import type { MoneyJson, ProductJson } from './api'

/**
 * Almacén local del navegador.
 *
 * Guarda lo imprescindible para seguir vendiendo cuando no hay internet: el
 * catálogo, la tasa del día, el bloque de números apartado y la cola de ventas
 * sin subir.
 *
 * Todo se guarda por negocio. Si alguien entra a otro negocio en la misma
 * máquina, no puede ver ni arrastrar lo del anterior.
 */

export interface ProductoLocal extends ProductJson {
  readonly tenantId: string
}

export type EstadoPendiente = 'PENDIENTE' | 'SUBIENDO' | 'FALLIDA'

export interface VentaPendiente {
  id?: number
  readonly tenantId: string
  readonly stationId: string
  /** Clave de idempotencia. Reenviar la misma venta no emite dos documentos. */
  readonly clientRef: string
  readonly reservedNumber: number
  readonly fullNumber: string
  /** Momento real de la venta, no el de la sincronización. */
  readonly occurredAt: string
  readonly cuerpo: unknown
  /** Total en bolívares, solo para poder mostrar la cola sin recalcular. */
  readonly totalVes: MoneyJson
  estado: EstadoPendiente
  intentos: number
  ultimoError?: string
}

export interface Ajuste {
  readonly clave: string
  readonly valor: unknown
}

class BaseLocal extends Dexie {
  productos!: EntityTable<ProductoLocal, 'productId'>
  pendientes!: EntityTable<VentaPendiente, 'id'>
  ajustes!: EntityTable<Ajuste, 'clave'>

  constructor() {
    super('fve')
    this.version(1).stores({
      productos: 'productId, tenantId, sku, barcode, name',
      pendientes: '++id, tenantId, clientRef, estado',
      ajustes: 'clave',
    })
  }
}

export const local = new BaseLocal()

// --- Ajustes ----------------------------------------------------------------

async function leer<T>(clave: string): Promise<T | null> {
  const fila = await local.ajustes.get(clave)
  return (fila?.valor as T) ?? null
}

async function guardar(clave: string, valor: unknown): Promise<void> {
  await local.ajustes.put({ clave, valor })
}

// --- Catálogo ---------------------------------------------------------------

/** Reemplaza el catálogo guardado. Se llama al entrar y al reconectar. */
export async function guardarCatalogo(tenantId: string, productos: ProductJson[]): Promise<void> {
  await local.transaction('rw', local.productos, async () => {
    await local.productos.where('tenantId').equals(tenantId).delete()
    await local.productos.bulkPut(productos.map((producto) => ({ ...producto, tenantId })))
  })
  await guardar(`catalogo:${tenantId}`, new Date().toISOString())
}

export async function catalogoGuardadoEl(tenantId: string): Promise<string | null> {
  return leer<string>(`catalogo:${tenantId}`)
}

/**
 * Busca en el catálogo guardado.
 *
 * Reproduce lo que hace el servidor —nombre, código o código de barras— para
 * que la caja se comporte igual con y sin internet. Una búsqueda que devuelve
 * cosas distintas según haya red es peor que no tener búsqueda.
 */
export async function buscarLocal(tenantId: string, consulta: string, limite = 8): Promise<ProductJson[]> {
  const termino = consulta.trim().toLowerCase()
  const todos = await local.productos.where('tenantId').equals(tenantId).toArray()

  if (termino === '') return todos.slice(0, limite)

  return todos
    .filter(
      (producto) =>
        producto.name.toLowerCase().includes(termino) ||
        producto.sku.toLowerCase().includes(termino) ||
        (producto.barcode ?? '').toLowerCase().includes(termino),
    )
    .slice(0, limite)
}

// --- Bloque de numeración ---------------------------------------------------

export interface BloqueLocal {
  readonly reservationId: string
  readonly prefix: string
  readonly from: number
  readonly to: number
  /** Próximo número a usar. Avanza con cada venta, aunque no se haya subido. */
  siguiente: number
}

export async function guardarBloque(tenantId: string, bloque: BloqueLocal): Promise<void> {
  await guardar(`bloque:${tenantId}`, bloque)
}

export async function leerBloque(tenantId: string): Promise<BloqueLocal | null> {
  return leer<BloqueLocal>(`bloque:${tenantId}`)
}

export async function olvidarBloque(tenantId: string): Promise<void> {
  await local.ajustes.delete(`bloque:${tenantId}`)
}

/**
 * Toma el siguiente número del bloque.
 *
 * El contador avanza aunque la venta todavía no se haya subido: si se reiniciara
 * en cada intento, dos ventas sin conexión recibirían el mismo consecutivo.
 * Devuelve `null` si el bloque se agotó — sin números apartados no se vende.
 */
export async function tomarNumero(tenantId: string): Promise<{ numero: number; fullNumber: string } | null> {
  const bloque = await leerBloque(tenantId)
  if (!bloque || bloque.siguiente > bloque.to) return null

  const numero = bloque.siguiente
  await guardarBloque(tenantId, { ...bloque, siguiente: numero + 1 })

  return { numero, fullNumber: `${bloque.prefix}-${String(numero).padStart(6, '0')}` }
}

// --- Tasa -------------------------------------------------------------------

export interface TasaLocal {
  readonly bsPerUsd: string
  readonly date: string
  readonly source: string
}

export async function guardarTasa(tenantId: string, tasa: TasaLocal): Promise<void> {
  await guardar(`tasa:${tenantId}`, tasa)
}

export async function leerTasa(tenantId: string): Promise<TasaLocal | null> {
  return leer<TasaLocal>(`tasa:${tenantId}`)
}

// --- Cola de ventas ---------------------------------------------------------

export async function encolarVenta(venta: Omit<VentaPendiente, 'id' | 'estado' | 'intentos'>): Promise<void> {
  await local.pendientes.add({ ...venta, estado: 'PENDIENTE', intentos: 0 })
}

export async function ventasPendientes(tenantId: string): Promise<VentaPendiente[]> {
  const filas = await local.pendientes.where('tenantId').equals(tenantId).toArray()
  return filas.sort((a, b) => a.reservedNumber - b.reservedNumber)
}

export async function contarPendientes(tenantId: string): Promise<number> {
  return local.pendientes.where('tenantId').equals(tenantId).count()
}

export async function marcarSubida(id: number): Promise<void> {
  await local.pendientes.delete(id)
}

export async function marcarFallo(id: number, error: string, definitivo: boolean): Promise<void> {
  const fila = await local.pendientes.get(id)
  if (!fila) return
  await local.pendientes.update(id, {
    estado: definitivo ? 'FALLIDA' : 'PENDIENTE',
    intentos: fila.intentos + 1,
    ultimoError: error,
  })
}

/** Descarta una venta que el servidor rechazó y que nadie va a poder subir. */
export async function descartarPendiente(id: number): Promise<void> {
  await local.pendientes.delete(id)
}

/** Borra todo lo guardado de un negocio. Se llama al salir. */
export async function limpiarNegocio(tenantId: string): Promise<void> {
  await local.productos.where('tenantId').equals(tenantId).delete()
  await local.ajustes.delete(`catalogo:${tenantId}`)
  await local.ajustes.delete(`bloque:${tenantId}`)
  await local.ajustes.delete(`tasa:${tenantId}`)
  // Las ventas pendientes NO se borran: son dinero que todavía no llegó al
  // servidor. Se quedan hasta que suban, aunque quien las hizo cierre sesión.
}
