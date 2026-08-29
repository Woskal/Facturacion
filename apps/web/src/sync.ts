import { ApiError, api, type ProductJson, type RateJson, type SaleResponse } from './api'
import {
  contarPendientes,
  descartarPendiente,
  guardarBloque,
  guardarCatalogo,
  guardarTasa,
  leerBloque,
  marcarFallo,
  marcarSubida,
  ventasPendientes,
  type BloqueLocal,
} from './local'

/** Cuántos números se apartan cada vez. Un día largo de una bodega cabe de sobra. */
export const TAMANO_BLOQUE = 200

/** Por debajo de esto se pide otro bloque, estando todavía en línea. */
export const UMBRAL_REPOSICION = 40

export interface EstadoSync {
  readonly pendientes: number
  readonly numerosDisponibles: number
  readonly ultimoError: string | null
}

/**
 * Deja la caja lista para quedarse sin internet.
 *
 * Se llama al entrar y cada vez que vuelve la conexión: guarda el catálogo y la
 * tasa, y se asegura de que haya números apartados. Lo importante es que esto
 * ocurra ANTES del corte — un bloque no se puede pedir sin conexión, que es
 * justo cuando hace falta.
 */
export async function prepararParaOffline(tenantId: string, stationId: string): Promise<void> {
  const [catalogo, tasa] = await Promise.all([
    api.get<{ products: ProductJson[] }>('/products?limit=200'),
    api.get<{ rate: RateJson }>('/rates/current'),
  ])

  await guardarCatalogo(tenantId, catalogo.products)
  await guardarTasa(tenantId, {
    bsPerUsd: tasa.rate.bsPerUsd,
    date: tasa.rate.date,
    source: tasa.rate.source,
  })

  await asegurarBloque(tenantId, stationId)
}

/**
 * Pide un bloque nuevo si el actual se está acabando.
 *
 * Se reponen los números con margen, no al agotarse: pedirlos cuando ya no
 * quedan implica estar en línea justo en ese instante, y la gracia de todo esto
 * es no depender de eso.
 */
export async function asegurarBloque(tenantId: string, stationId: string): Promise<BloqueLocal> {
  const actual = await leerBloque(tenantId)
  const disponibles = actual ? actual.to - actual.siguiente + 1 : 0

  if (actual && disponibles > UMBRAL_REPOSICION) return actual

  const { block } = await api.post<{
    block: { reservationId: string; prefix: string; from: number; to: number }
  }>(`/stations/${stationId}/number-blocks`, { count: TAMANO_BLOQUE, kind: 'NOTA_ENTREGA' })

  const nuevo: BloqueLocal = {
    reservationId: block.reservationId,
    prefix: block.prefix,
    from: block.from,
    to: block.to,
    siguiente: block.from,
  }

  await guardarBloque(tenantId, nuevo)
  return nuevo
}

export interface ResultadoSync {
  readonly subidas: number
  readonly fallidas: number
  readonly pendientes: number
}

/**
 * Sube lo que se vendió sin conexión.
 *
 * Va en orden de número y se detiene ante el primer fallo de red: si no hay
 * internet, insistir con las demás solo gasta tiempo. Un rechazo del servidor
 * —un 4xx— es otra cosa: esa venta no va a poder subir nunca tal como está, así
 * que se marca y se sigue con la siguiente en vez de atascar la cola entera.
 *
 * Reenviar una venta ya subida es inofensivo: el servidor la reconoce por su
 * `clientRef` y devuelve el mismo documento.
 */
export async function sincronizar(tenantId: string): Promise<ResultadoSync> {
  const cola = await ventasPendientes(tenantId)
  let subidas = 0
  let fallidas = 0

  for (const venta of cola) {
    if (venta.id === undefined) continue

    try {
      await api.post<SaleResponse>('/sales', venta.cuerpo)
      await marcarSubida(venta.id)
      subidas += 1
    } catch (fallo) {
      if (fallo instanceof ApiError) {
        if (fallo.status === 401 || fallo.status === 403) {
          // La sesión se cayó: no tiene sentido seguir intentando.
          await marcarFallo(venta.id, fallo.message, false)
          break
        }
        // El servidor la rechazó por su contenido. No va a mejorar sola.
        await marcarFallo(venta.id, fallo.message, true)
        fallidas += 1
        continue
      }

      // Fallo de red: se corta y se reintenta cuando vuelva la conexión.
      await marcarFallo(venta.id, 'Sin conexión', false)
      break
    }
  }

  return { subidas, fallidas, pendientes: await contarPendientes(tenantId) }
}

export async function estadoSync(tenantId: string): Promise<EstadoSync> {
  const [pendientes, bloque, cola] = await Promise.all([
    contarPendientes(tenantId),
    leerBloque(tenantId),
    ventasPendientes(tenantId),
  ])

  return {
    pendientes,
    numerosDisponibles: bloque ? bloque.to - bloque.siguiente + 1 : 0,
    ultimoError: cola.find((venta) => venta.estado === 'FALLIDA')?.ultimoError ?? null,
  }
}

/** Descarta una venta que el servidor rechazó de forma definitiva. */
export async function descartar(id: number): Promise<void> {
  await descartarPendiente(id)
}
