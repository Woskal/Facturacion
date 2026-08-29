import { useCallback, useEffect, useState } from 'react'
import { formatRate, rate as makeRate, type Rate } from '@fve/money'

import { ApiError, api, getToken, setToken, type LoginResponse, type Membership, type RateJson } from './api'
import { Aviso, Boton } from './components/ui'
import { Caja } from './pages/Caja'
import { Catalogo } from './pages/Catalogo'
import { Clientes } from './pages/Clientes'
import { ElegirNegocio } from './pages/ElegirNegocio'
import { Login } from './pages/Login'
import { Operador } from './pages/Operador'
import { Venta } from './pages/Venta'

type Estado =
  | { fase: 'cargando' }
  | { fase: 'fuera' }
  | { fase: 'eligiendo'; memberships: Membership[] }
  | { fase: 'dentro'; negocio: string; tenantId: string }

type Seccion = 'venta' | 'catalogo' | 'clientes' | 'caja' | 'plataforma'

const SECCIONES: { clave: Seccion; nombre: string }[] = [
  { clave: 'venta', nombre: 'Venta' },
  { clave: 'catalogo', nombre: 'Catálogo' },
  { clave: 'clientes', nombre: 'Clientes' },
  { clave: 'caja', nombre: 'Caja' },
]

export function App() {
  const [estado, setEstado] = useState<Estado>({ fase: 'cargando' })
  const [seccion, setSeccion] = useState<Seccion>('venta')
  const [esOperador, setEsOperador] = useState(false)
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
      .get<{
        user: { isPlatformAdmin: boolean }
        activeTenantId: string | null
        memberships: Membership[]
      }>('/auth/me')
      .then((yo) => {
        setEsOperador(yo.user.isPlatformAdmin)
        if (yo.activeTenantId) {
          const actual = yo.memberships.find((m) => m.tenantId === yo.activeTenantId)
          setEstado({ fase: 'dentro', tenantId: yo.activeTenantId, negocio: actual?.tenantName ?? 'Negocio' })
        } else if (yo.memberships.length === 0 && yo.user.isPlatformAdmin) {
          // Un operador sin negocios propios entra directo a su panel.
          setEstado({ fase: 'eligiendo', memberships: [] })
          setSeccion('plataforma')
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
      setAvisoTasa(fallo instanceof ApiError ? fallo.message : 'No se pudo obtener la tasa del día.')
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
    setEsOperador(sesion.user.isPlatformAdmin)

    if (sesion.memberships.length === 1) {
      const unico = sesion.memberships[0]!
      void api
        .post('/auth/select-tenant', { tenantId: unico.tenantId })
        .then(() => setEstado({ fase: 'dentro', tenantId: unico.tenantId, negocio: unico.tenantName }))
      return
    }

    if (sesion.memberships.length === 0 && sesion.user.isPlatformAdmin) {
      setEstado({ fase: 'eligiendo', memberships: [] })
      setSeccion('plataforma')
      return
    }

    setEstado({ fase: 'eligiendo', memberships: sesion.memberships })
  }

  async function salir() {
    await api.post('/auth/logout').catch(() => undefined)
    setToken(null)
    setRate(null)
    setStationId(null)
    setEsOperador(false)
    setSeccion('venta')
    setEstado({ fase: 'fuera' })
  }

  if (estado.fase === 'cargando') {
    return <p className="p-10 text-center text-sm text-apagado">Cargando…</p>
  }

  if (estado.fase === 'fuera') {
    return <Login onEntrar={entrar} />
  }

  // Un operador sin negocio abierto ve solo su panel.
  if (estado.fase === 'eligiendo' && seccion === 'plataforma') {
    return (
      <Marco
        titulo="Plataforma"
        subtitulo="Panel del operador"
        pestanas={[]}
        seccion={seccion}
        onSeccion={setSeccion}
        onSalir={() => void salir()}
      >
        <Operador />
      </Marco>
    )
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

  const pestanas = esOperador ? [...SECCIONES, { clave: 'plataforma' as const, nombre: 'Plataforma' }] : SECCIONES

  return (
    <Marco
      titulo={estado.negocio}
      subtitulo={rate ? `Bs ${formatRate(rate)} por dólar · ${rate.source} · ${rate.date}` : 'Sin tasa cargada'}
      pestanas={pestanas}
      seccion={seccion}
      onSeccion={setSeccion}
      onSalir={() => void salir()}
    >
      {avisoTasa ? (
        <Aviso tipo="alerta">
          {avisoTasa} Cargue la tasa del día antes de vender: sin ella no se puede emitir nada.
        </Aviso>
      ) : null}

      {seccion === 'plataforma' ? <Operador /> : null}

      {rate && seccion === 'catalogo' ? <Catalogo rate={rate} /> : null}
      {rate && seccion === 'clientes' ? <Clientes rate={rate} /> : null}

      {rate && stationId && seccion === 'venta' ? (
        <Venta rate={rate} stationId={stationId} onVendido={() => void cargarTasa()} />
      ) : null}

      {rate && stationId && seccion === 'caja' ? <Caja stationId={stationId} rate={rate} /> : null}

      {rate && !stationId && seccion !== 'plataforma' ? (
        <Aviso tipo="alerta">Este negocio no tiene ninguna caja configurada, así que no se puede vender.</Aviso>
      ) : null}
    </Marco>
  )
}

function Marco({
  titulo,
  subtitulo,
  pestanas,
  seccion,
  onSeccion,
  onSalir,
  children,
}: {
  titulo: string
  subtitulo: string
  pestanas: { clave: Seccion; nombre: string }[]
  seccion: Seccion
  onSeccion: (valor: Seccion) => void
  onSalir: () => void
  children: React.ReactNode
}) {
  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-borde bg-white">
        <div className="flex items-center justify-between gap-4 px-5 pb-2 pt-2.5">
          <div className="min-w-0">
            <span className="block truncate text-sm font-semibold">{titulo}</span>
            <span className="cifra block text-xs text-apagado">{subtitulo}</span>
          </div>
          <Boton variante="plano" onClick={onSalir}>
            Salir
          </Boton>
        </div>

        {pestanas.length > 0 ? (
          <nav className="flex gap-1 px-4">
            {pestanas.map((pestana) => (
              <button
                key={pestana.clave}
                onClick={() => onSeccion(pestana.clave)}
                className={`-mb-px border-b-2 px-3 py-2 text-sm transition ${
                  seccion === pestana.clave
                    ? 'border-acento font-medium text-acento'
                    : 'border-transparent text-apagado hover:text-tinta'
                }`}
              >
                {pestana.nombre}
              </button>
            ))}
          </nav>
        ) : null}
      </header>

      <main className="min-h-0 flex-1 space-y-3 p-4">{children}</main>
    </div>
  )
}
