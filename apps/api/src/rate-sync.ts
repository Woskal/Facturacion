import type { FastifyBaseLogger } from 'fastify'
import type { Database } from '@fve/db'
import { syncBcvRateForAllTenants } from '@fve/core'

/**
 * Cada cuánto se consulta al BCV.
 *
 * El BCV publica una vez al día, así que consultar cada hora ya es holgado.
 * Hacerlo cada minuto no traería una tasa más fresca: solo castigaría el sitio
 * de un banco central que terminaría bloqueándonos, con razón.
 */
export const DEFAULT_SYNC_MINUTES = 60

export interface RateSyncOptions {
  readonly db: Database
  readonly logger: FastifyBaseLogger
  readonly minutes?: number | undefined
  /** Si se consulta al arrancar. Se apaga en los tests. */
  readonly immediate?: boolean | undefined
}

export interface RateSyncHandle {
  readonly runNow: () => Promise<void>
  readonly stop: () => void
}

/**
 * Mantiene la tasa al día sola.
 *
 * Un fallo NUNCA detiene el servidor ni la venta: si el BCV no responde, el
 * negocio sigue operando con la última tasa conocida y con la posibilidad de
 * cargarla a mano. Una caja que deja de vender porque un sitio web está caído
 * sería un problema peor que el que resuelve.
 */
export function startRateSync(options: RateSyncOptions): RateSyncHandle {
  const minutes = options.minutes ?? DEFAULT_SYNC_MINUTES

  const runNow = async () => {
    try {
      const result = await syncBcvRateForAllTenants(options.db)
      options.logger.info(
        {
          tasa: result.quote.value,
          fechaValor: result.quote.effectiveOn,
          aplicadas: result.applied,
          sinCambio: result.unchanged,
          omitidasManuales: result.skipped,
          rechazadas: result.rejected,
        },
        'tasa BCV sincronizada',
      )
    } catch (error) {
      options.logger.warn(
        { err: error },
        'no se pudo sincronizar la tasa del BCV; se sigue con la última conocida',
      )
    }
  }

  const timer = setInterval(() => void runNow(), minutes * 60 * 1000)
  // No debe mantener vivo el proceso por sí solo al apagar el servidor.
  timer.unref?.()

  if (options.immediate ?? true) {
    void runNow()
  }

  return { runNow, stop: () => clearInterval(timer) }
}
