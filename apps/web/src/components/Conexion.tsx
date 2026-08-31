import { useCallback, useEffect, useState } from 'react'

import { Boton } from './ui'
import { estadoSync, sincronizar, type EstadoSync } from '../sync'

/**
 * Estado de la conexión.
 *
 * `navigator.onLine` dice si hay red, no si el servidor responde: una caja
 * conectada a un módem sin salida a internet se reporta «en línea». Por eso
 * además se consulta el servidor cada cierto tiempo, y lo que manda es esa
 * respuesta.
 */
export function useConexion(): { enLinea: boolean; comprobar: () => Promise<void> } {
  const [enLinea, setEnLinea] = useState(navigator.onLine)

  const comprobar = useCallback(async () => {
    if (!navigator.onLine) {
      setEnLinea(false)
      return
    }

    try {
      const respuesta = await fetch('/api/health', {
        cache: 'no-store',
        signal: AbortSignal.timeout(4000),
      })
      setEnLinea(respuesta.ok)
    } catch {
      setEnLinea(false)
    }
  }, [])

  useEffect(() => {
    const alConectar = () => void comprobar()
    const alDesconectar = () => setEnLinea(false)

    window.addEventListener('online', alConectar)
    window.addEventListener('offline', alDesconectar)
    void comprobar()

    const temporizador = setInterval(() => void comprobar(), 20_000)

    return () => {
      window.removeEventListener('online', alConectar)
      window.removeEventListener('offline', alDesconectar)
      clearInterval(temporizador)
    }
  }, [comprobar])

  return { enLinea, comprobar }
}

/**
 * Barra de estado del modo sin conexión.
 *
 * Muestra siempre dos cosas que el cajero necesita saber sin preguntar: si hay
 * internet y cuántas ventas están sin subir. Una caja que acumula ventas en
 * silencio y luego pierde el dispositivo es la peor forma de perder dinero.
 */
export function BarraConexion({
  tenantId,
  enLinea,
  refresco,
}: {
  tenantId: string
  enLinea: boolean
  refresco: number
}) {
  const [estado, setEstado] = useState<EstadoSync>({ pendientes: 0, numerosDisponibles: 0, ultimoError: null })
  const [subiendo, setSubiendo] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)

  const refrescar = useCallback(async () => {
    setEstado(await estadoSync(tenantId))
  }, [tenantId])

  useEffect(() => {
    void refrescar()
  }, [refrescar, refresco, enLinea])

  const subir = useCallback(async () => {
    setSubiendo(true)
    setAviso(null)
    try {
      const resultado = await sincronizar(tenantId)
      if (resultado.subidas > 0) {
        setAviso(`${resultado.subidas} venta${resultado.subidas === 1 ? '' : 's'} subida${resultado.subidas === 1 ? '' : 's'}.`)
      }
      if (resultado.fallidas > 0) {
        setAviso(`${resultado.fallidas} venta${resultado.fallidas === 1 ? '' : 's'} rechazada${resultado.fallidas === 1 ? '' : 's'} por el servidor.`)
      }
      await refrescar()
    } finally {
      setSubiendo(false)
    }
  }, [tenantId, refrescar])

  // Al volver la conexión se sube solo lo acumulado. Depender de que alguien
  // pulse un botón es depender de que se acuerde.
  useEffect(() => {
    if (enLinea && estado.pendientes > 0 && !subiendo) {
      void subir()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enLinea, estado.pendientes])

  const sinNumeros = estado.numerosDisponibles === 0
  const pocosNumeros = estado.numerosDisponibles > 0 && estado.numerosDisponibles <= 20

  if (enLinea && estado.pendientes === 0 && !sinNumeros && !pocosNumeros) {
    return null
  }

  const tono = !enLinea
    ? 'border-alerta/30 bg-alerta-tenue text-alerta'
    : estado.pendientes > 0
      ? 'border-acento/25 bg-acento-tenue text-acento'
      : 'border-borde bg-tenue text-apagado'

  const puntoTono = !enLinea ? 'bg-alerta' : estado.pendientes > 0 ? 'bg-acento' : 'bg-exito'

  return (
    <div className={`flex flex-wrap items-center gap-3 rounded-lg border px-3.5 py-2 text-sm ${tono}`}>
      <span className="flex items-center gap-2 font-medium">
        <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${puntoTono}`} />
        {enLinea ? 'En línea' : 'Sin conexión'}
      </span>

      {!enLinea ? (
        <span>
          Las ventas se guardan en esta caja y suben solas al volver el internet.
          {sinNumeros ? ' No quedan números apartados: conéctese antes de seguir vendiendo.' : ''}
          {pocosNumeros ? ` Quedan ${estado.numerosDisponibles} números apartados.` : ''}
        </span>
      ) : null}

      {estado.pendientes > 0 ? (
        <span>
          {estado.pendientes} venta{estado.pendientes === 1 ? '' : 's'} sin subir
        </span>
      ) : null}

      {enLinea && (sinNumeros || pocosNumeros) && estado.pendientes === 0 ? (
        <span>
          {sinNumeros
            ? 'Sin números apartados para operar sin conexión.'
            : `Quedan ${estado.numerosDisponibles} números apartados.`}
        </span>
      ) : null}

      {estado.ultimoError ? <span className="text-error">{estado.ultimoError}</span> : null}
      {aviso ? <span>{aviso}</span> : null}

      <div className="flex-1" />

      {enLinea && estado.pendientes > 0 ? (
        <Boton variante="plano" disabled={subiendo} onClick={() => void subir()}>
          {subiendo ? 'Subiendo…' : 'Subir ahora'}
        </Boton>
      ) : null}
    </div>
  )
}
