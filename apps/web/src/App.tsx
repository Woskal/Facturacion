import { useCallback, useEffect, useState } from 'react'
import { formatRate, rate as makeRate, type Rate } from '@fve/money'

import { ApiError, api, getToken, setToken, type LoginResponse, type Membership, type RateJson } from './api'
import { Aviso, Boton } from './components/ui'
import { ElegirNegocio } from './pages/ElegirNegocio'
import { Login } from './pages/Login'
import { Venta } from './pages/Venta'

type Estado =
  | { fase: 'cargando' }
  | { fase: 'fuera' }
  | { fase: 'eligiendo'; memberships: Membership[] }
  | { fase: 'dentro'; negocio: string; tenantId: string }

export function App() {
  const [estado, setEstado] = useState<Estado>({ fase: 'cargando' })
  const [rate, setRate] = useState<Rate | null>(null)
  const [stationId, setStationId] = useState<string | null>(null)
  const [avisoTasa, setAvisoTasa] = useState<string | null>(null)

  /** Recupera la sesión guardada al abrir. */
  useEffect(() => {
    if (!getToken()) {
      setEstado({ fase: 'fuera' })
      return
    }

    void api
      .get<{ activeTenantId: string | null; memberships: Membership[] }>('/auth/me')
      .then((yo) => {
        if (yo.activeTenantId) {
          const actual = yo.memberships.find((m) => m.tenantId === yo.activeTenantId)
          setEstado({
            fase: 'dentro',
            tenantId: yo.activeTenantId,
            negocio: actual?.tenantName ?? 'Negocio',
          })
        } else {
          setEstado({ fase: 'eligiendo', memberships: yo.memberships })
        }
      })
      .catch(() => {
        setToken(null)
        setEstado({ fase: 'fuera' })
      })
  }, [])

  const cargarTasa = useCallback(async () => {
    try {
      const data = await api.get<{ rate: RateJson }>('/rates/current')
      setRate(makeRate(BigInt(data.rate.bsPerUsd), data.rate.date, data.rate.source as 'BCV'))
      setAvisoTasa(null)
    } catch (fallo) {
      setRate(null)
      setAvisoTasa(
        fallo instanceof ApiError
          ? fallo.message
          : 'No se pudo obtener la tasa del día.',
      )
    }
  }, [])

  /**
   * Al entrar a un negocio se resuelven las dos cosas sin las que no se puede
   * vender: la tasa del día y en qué caja se está.
   */
  useEffect(() => {
    if (estado.fase !== 'dentro') return

    void cargarTasa()
    void api
      .get<{ stations: { stationId: string; name: string }[] }>('/stations')
      .then((data) => setStationId(data.stations[0]?.stationId ?? null))
      .catch(() => setStationId(null))
  }, [estado.fase, estado.fase === 'dentro' ? estado.tenantId : null, cargarTasa])

  /**
   * La tasa se refresca sola cada cinco minutos.
   *
   * El servidor la sincroniza con el BCV por su cuenta; esto solo evita que una
   * caja abierta todo el día siga mostrando la de la mañana.
   */
  useEffect(() => {
    if (estado.fase !== 'dentro') return
    const temporizador = setInterval(() => void cargarTasa(), 5 * 60 * 1000)
    return () => clearInterval(temporizador)
  }, [estado.fase, cargarTasa])

  function entrar(sesion: LoginResponse) {
    if (sesion.memberships.length === 1) {
      const unico = sesion.memberships[0]!
      void api.post('/auth/select-tenant', { tenantId: unico.tenantId }).then(() =>
        setEstado({ fase: 'dentro', tenantId: unico.tenantId, negocio: unico.tenantName }),
      )
      return
    }
    setEstado({ fase: 'eligiendo', memberships: sesion.memberships })
  }

  async function salir() {
    await api.post('/auth/logout').catch(() => undefined)
    setToken(null)
    setRate(null)
    setStationId(null)
    setEstado({ fase: 'fuera' })
  }

  if (estado.fase === 'cargando') {
    return <p className="p-10 text-center text-sm text-apagado">Cargando…</p>
  }

  if (estado.fase === 'fuera') {
    return <Login onEntrar={entrar} />
  }

  if (estado.fase === 'eligiendo') {
    return (
      <ElegirNegocio
        memberships={estado.memberships}
        onElegido={(tenantId, negocio) => setEstado({ fase: 'dentro', tenantId, negocio })}
        onSalir={() => void salir()}
      />
    )
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-borde bg-white px-5 py-2.5">
        <div className="min-w-0">
          <span className="block truncate text-sm font-semibold">{estado.negocio}</span>
          <span className="block text-xs text-apagado">Punto de venta</span>
        </div>

        <div className="flex items-center gap-4">
          {rate ? (
            <div className="text-right">
              <span className="cifra block text-sm font-medium">Bs {formatRate(rate)}</span>
              <span className="block text-xs text-apagado">
                por dólar · {rate.source} · {rate.date}
              </span>
            </div>
          ) : null}
          <Boton variante="plano" onClick={() => void salir()}>
            Salir
          </Boton>
        </div>
      </header>

      <main className="min-h-0 flex-1 p-4">
        {avisoTasa ? (
          <Aviso tipo="alerta">
            {avisoTasa} Cargue la tasa del día antes de vender: sin ella no se puede emitir nada.
          </Aviso>
        ) : null}

        {rate && stationId ? (
          <Venta rate={rate} stationId={stationId} onVendido={() => void cargarTasa()} />
        ) : null}

        {rate && !stationId ? (
          <Aviso tipo="alerta">
            Este negocio no tiene ninguna caja configurada, así que no se puede vender.
          </Aviso>
        ) : null}
      </main>
    </div>
  )
}
