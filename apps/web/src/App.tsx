import { useCallback, useEffect, useState } from 'react'
import { formatRate, rate as makeRate, type Rate } from '@fve/money'

import { ApiError, api, getToken, setToken, type LoginResponse, type Membership, type RateJson } from './api'
import { Aviso } from './components/ui'
import { IconoMenu, IconoSalir, iconos } from './components/iconos'
import { BarraConexion, useConexion } from './components/Conexion'
import { guardarTasa, leerTasa, limpiarNegocio } from './local'
import { prepararParaOffline } from './sync'
import { Caja } from './pages/Caja'
import { Catalogo } from './pages/Catalogo'
import { Clientes } from './pages/Clientes'
import { Documentos } from './pages/Documentos'
import { Gastos } from './pages/Gastos'
import { Proveedores } from './pages/Proveedores'
import { ElegirNegocio } from './pages/ElegirNegocio'
import { Login } from './pages/Login'
import { Cobranza } from './pages/Cobranza'
import { Operador } from './pages/Operador'
import { Reportes } from './pages/Reportes'
import { Venta } from './pages/Venta'

type Estado =
  | { fase: 'cargando' }
  | { fase: 'fuera' }
  | { fase: 'eligiendo'; memberships: Membership[] }
  | { fase: 'dentro'; negocio: string; tenantId: string }

type Seccion =
  | 'venta'
  | 'documentos'
  | 'catalogo'
  | 'clientes'
  | 'proveedores'
  | 'gastos'
  | 'caja'
  | 'reportes'
  | 'plataforma'
  | 'cobranza'

const SECCIONES: { clave: Seccion; nombre: string }[] = [
  { clave: 'venta', nombre: 'Venta' },
  { clave: 'documentos', nombre: 'Documentos' },
  { clave: 'catalogo', nombre: 'Catálogo' },
  { clave: 'clientes', nombre: 'Clientes' },
  { clave: 'proveedores', nombre: 'Proveedores' },
  { clave: 'gastos', nombre: 'Gastos' },
  { clave: 'caja', nombre: 'Caja' },
  { clave: 'reportes', nombre: 'Reportes' },
]

export function App() {
  const [estado, setEstado] = useState<Estado>({ fase: 'cargando' })
  const [seccion, setSeccion] = useState<Seccion>('venta')
  const [esOperador, setEsOperador] = useState(false)
  const [rate, setRate] = useState<Rate | null>(null)
  const [stationId, setStationId] = useState<string | null>(null)
  const [avisoTasa, setAvisoTasa] = useState<string | null>(null)
  const [refrescoCola, setRefrescoCola] = useState(0)
  const { enLinea } = useConexion()

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

  /**
   * Resuelve la tasa del día.
   *
   * Sin internet se usa la última guardada. Una tasa de ayer es imprecisa; no
   * poder vender es peor, y el documento guarda cuál se usó, así que el
   * histórico no miente.
   */
  const cargarTasa = useCallback(
    async (tenantId: string) => {
      try {
        const data = await api.get<{ rate: RateJson }>('/rates/current')
        setRate(makeRate(BigInt(data.rate.bsPerUsd), data.rate.date, data.rate.source as 'BCV'))
        await guardarTasa(tenantId, {
          bsPerUsd: data.rate.bsPerUsd,
          date: data.rate.date,
          source: data.rate.source,
        })
        setAvisoTasa(null)
      } catch (fallo) {
        const guardada = await leerTasa(tenantId)
        if (guardada) {
          setRate(makeRate(BigInt(guardada.bsPerUsd), guardada.date, guardada.source as 'BCV'))
          setAvisoTasa(null)
          return
        }
        setRate(null)
        setAvisoTasa(fallo instanceof ApiError ? fallo.message : 'No se pudo obtener la tasa del día.')
      }
    },
    [],
  )

  /**
   * Al entrar a un negocio se resuelven las dos cosas sin las que no se puede
   * vender: la tasa del día y en qué caja se está.
   */
  useEffect(() => {
    if (estado.fase !== 'dentro') return
    const tenantId = estado.tenantId

    void cargarTasa(tenantId)
    void api
      .get<{ stations: { stationId: string; name: string }[] }>('/stations')
      .then((data) => setStationId(data.stations[0]?.stationId ?? null))
      .catch(() => setStationId(null))
  }, [estado.fase, estado.fase === 'dentro' ? estado.tenantId : null, cargarTasa])

  /**
   * Prepara la caja para quedarse sin internet.
   *
   * Guarda catálogo, tasa y un bloque de números APARTADOS, y lo hace cada vez
   * que vuelve la conexión. Un bloque no se puede pedir sin red, que es justo
   * cuando hace falta: por eso se pide antes, no cuando ya no queda.
   */
  useEffect(() => {
    if (estado.fase !== 'dentro' || !stationId || !enLinea) return
    void prepararParaOffline(estado.tenantId, stationId)
      .then(() => setRefrescoCola((n) => n + 1))
      .catch(() => undefined)
  }, [estado.fase, estado.fase === 'dentro' ? estado.tenantId : null, stationId, enLinea])

  /**
   * La tasa se refresca sola cada minuto.
   *
   * El servidor la sincroniza con el BCV por su cuenta; esto mantiene la caja al
   * día sin que nadie recargue, para que una caja abierta todo el día nunca
   * muestre la tasa de la mañana. Al volver de estar oculta la pestaña también
   * se refresca, porque el temporizador se frena en segundo plano.
   */
  useEffect(() => {
    if (estado.fase !== 'dentro') return
    const tenantId = estado.tenantId
    const temporizador = setInterval(() => void cargarTasa(tenantId), 60 * 1000)
    const alVolver = () => {
      if (document.visibilityState === 'visible') void cargarTasa(tenantId)
    }
    document.addEventListener('visibilitychange', alVolver)
    return () => {
      clearInterval(temporizador)
      document.removeEventListener('visibilitychange', alVolver)
    }
  }, [estado.fase, estado.fase === 'dentro' ? estado.tenantId : null, cargarTasa])

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
    if (estado.fase === 'dentro') {
      // La cola de ventas sin subir NO se borra: es dinero que todavía no llegó
      // al servidor.
      await limpiarNegocio(estado.tenantId).catch(() => undefined)
    }
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
  if (estado.fase === 'eligiendo' && (seccion === 'plataforma' || seccion === 'cobranza')) {
    return (
      <Marco
        titulo="Plataforma"
        subtitulo="Panel del operador"
        pestanas={[
          { clave: 'plataforma', nombre: 'Negocios' },
          { clave: 'cobranza', nombre: 'Cobranza' },
        ]}
        seccion={seccion}
        onSeccion={setSeccion}
        onSalir={() => void salir()}
      >
        {seccion === 'cobranza' ? <Cobranza /> : <Operador />}
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

  const pestanas = esOperador
    ? [
        ...SECCIONES,
        { clave: 'plataforma' as const, nombre: 'Plataforma' },
        { clave: 'cobranza' as const, nombre: 'Cobranza' },
      ]
    : SECCIONES

  return (
    <Marco
      titulo={estado.negocio}
      subtitulo={rate ? `Bs ${formatRate(rate)} por dólar · ${rate.source} · ${rate.date}` : 'Sin tasa cargada'}
      pestanas={pestanas}
      seccion={seccion}
      onSeccion={setSeccion}
      onSalir={() => void salir()}
    >
      {estado.fase === 'dentro' ? (
        <BarraConexion tenantId={estado.tenantId} enLinea={enLinea} refresco={refrescoCola} />
      ) : null}

      {avisoTasa ? (
        <Aviso tipo="alerta">
          {avisoTasa} Cargue la tasa del día antes de vender: sin ella no se puede emitir nada.
        </Aviso>
      ) : null}

      {seccion === 'plataforma' ? <Operador /> : null}
      {seccion === 'cobranza' ? <Cobranza /> : null}

      {seccion === 'documentos' ? <Documentos /> : null}
      {seccion === 'proveedores' ? <Proveedores /> : null}
      {seccion === 'gastos' ? <Gastos /> : null}
      {rate && seccion === 'catalogo' ? <Catalogo rate={rate} /> : null}
      {rate && seccion === 'clientes' ? <Clientes rate={rate} /> : null}
      {seccion === 'reportes' ? <Reportes /> : null}

      {rate && stationId && seccion === 'venta' ? (
        <Venta
          rate={rate}
          stationId={stationId}
          tenantId={estado.tenantId}
          enLinea={enLinea}
          onVendido={() => setRefrescoCola((n) => n + 1)}
        />
      ) : null}

      {rate && stationId && seccion === 'caja' ? <Caja stationId={stationId} rate={rate} /> : null}

      {rate &&
      !stationId &&
      seccion !== 'plataforma' &&
      seccion !== 'cobranza' &&
      seccion !== 'reportes' &&
      seccion !== 'documentos' &&
      seccion !== 'proveedores' &&
      seccion !== 'gastos' ? (
        <Aviso tipo="alerta">Este negocio no tiene ninguna caja configurada, así que no se puede vender.</Aviso>
      ) : null}
    </Marco>
  )
}

/**
 * Marco de la aplicación.
 *
 * En pantalla ancha, una barra lateral fija con la navegación; el área de
 * trabajo ocupa el resto y se desplaza sola. En un teléfono la barra se esconde
 * detrás de un botón y entra como cajón, para que el pulgar tenga toda la
 * pantalla para el trabajo. La interfaz de props es la misma en ambos casos.
 */
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
  const [menuAbierto, setMenuAbierto] = useState(false)
  const activa = pestanas.find((p) => p.clave === seccion)

  const navegar = (clave: Seccion) => {
    onSeccion(clave)
    setMenuAbierto(false)
  }

  const listaNav = (
    <nav className="flex flex-col gap-0.5">
      {pestanas.map((pestana) => {
        const seleccionada = seccion === pestana.clave
        return (
          <button
            key={pestana.clave}
            onClick={() => navegar(pestana.clave)}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
              seleccionada
                ? 'bg-acento text-white shadow-suave'
                : 'text-marca-apagado hover:bg-marca-alta hover:text-marca-texto'
            }`}
          >
            <span className={seleccionada ? 'text-white' : 'text-marca-apagado'}>
              {iconos[pestana.clave] ?? iconos.documentos}
            </span>
            {pestana.nombre}
          </button>
        )
      })}
    </nav>
  )

  const cabeceraNegocio = (
    <div className="min-w-0">
      <span className="block truncate text-sm font-semibold text-marca-texto">{titulo}</span>
      <span className="cifra block truncate text-xs text-marca-apagado">{subtitulo}</span>
    </div>
  )

  const botonSalir = (
    <button
      onClick={onSalir}
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-marca-apagado transition hover:bg-marca-alta hover:text-marca-texto"
    >
      <IconoSalir />
      Salir
    </button>
  )

  return (
    <div className="flex h-full bg-papel lg:gap-0">
      {/* Barra lateral fija oscura — solo pantalla ancha. */}
      <aside className="hidden w-64 shrink-0 flex-col bg-marca lg:flex">
        <div className="border-b border-marca-borde px-5 py-4">{cabeceraNegocio}</div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">{listaNav}</div>
        <div className="border-t border-marca-borde p-3">{botonSalir}</div>
      </aside>

      {/* Cajón oscuro — solo teléfono. */}
      {menuAbierto ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="atenuar absolute inset-0 bg-tinta/50" onClick={() => setMenuAbierto(false)} />
          <aside className="surgir absolute inset-y-0 left-0 flex w-72 max-w-[82%] flex-col bg-marca">
            <div className="flex items-center justify-between gap-3 border-b border-marca-borde px-5 py-4">
              {cabeceraNegocio}
              <button
                onClick={() => setMenuAbierto(false)}
                aria-label="Cerrar menú"
                className="shrink-0 rounded-lg p-1.5 text-marca-apagado hover:bg-marca-alta hover:text-marca-texto"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">{listaNav}</div>
            <div className="border-t border-borde p-3">{botonSalir}</div>
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Barra superior — solo teléfono. */}
        <header className="flex items-center gap-3 border-b border-borde bg-marca px-4 py-2.5 lg:hidden">
          <button
            onClick={() => setMenuAbierto(true)}
            aria-label="Abrir menú"
            className="-ml-1 shrink-0 rounded-lg p-1.5 text-tinta hover:bg-tenue"
          >
            <IconoMenu />
          </button>
          <div className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-tinta">{activa?.nombre ?? titulo}</span>
            <span className="cifra block truncate text-xs text-apagado">{titulo}</span>
          </div>
        </header>

        <main className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 lg:p-6">{children}</main>
      </div>
    </div>
  )
}
