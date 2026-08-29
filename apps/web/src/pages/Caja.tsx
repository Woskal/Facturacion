import { useCallback, useEffect, useState } from 'react'
import { formatMoney, type Rate } from '@fve/money'

import { ApiError, api, toMoney, type CashSessionJson } from '../api'
import { aMonto } from '../formato'
import { Aviso, Boton, Campo, Tarjeta, Vacio } from '../components/ui'

const NOMBRES: Record<string, string> = {
  EFECTIVO_BS: 'Efectivo Bs',
  EFECTIVO_USD: 'Efectivo divisa',
  PAGO_MOVIL: 'Pago móvil',
  TRANSFERENCIA_BS: 'Transferencia',
  PUNTO_VENTA: 'Punto de venta',
  ZELLE: 'Zelle',
  USDT: 'USDT',
}

export function Caja({ stationId }: { stationId: string; rate: Rate }) {
  const [sesion, setSesion] = useState<CashSessionJson | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [conteo, setConteo] = useState<Record<string, string>>({})
  const [ocupado, setOcupado] = useState(false)

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const data = await api.get<{ session: CashSessionJson | null }>(`/cash/current?stationId=${stationId}`)
      setSesion(data.session)
      setError(null)
    } catch (fallo) {
      setError(fallo instanceof ApiError ? fallo.message : 'No se pudo consultar la caja.')
    } finally {
      setCargando(false)
    }
  }, [stationId])

  useEffect(() => {
    void cargar()
  }, [cargar])

  async function abrir() {
    setOcupado(true)
    setError(null)
    try {
      await api.post('/cash/open', {
        stationId,
        opening: [
          { method: 'EFECTIVO_BS', currency: 'VES', amount: '0' },
          { method: 'EFECTIVO_USD', currency: 'USD', amount: '0' },
        ],
      })
      await cargar()
    } catch (fallo) {
      setError(fallo instanceof ApiError ? fallo.message : 'No se pudo abrir la caja.')
    } finally {
      setOcupado(false)
    }
  }

  async function cerrar() {
    if (!sesion) return
    setOcupado(true)
    setError(null)

    try {
      const counted = sesion.lines.map((linea) => {
        const texto = conteo[`${linea.method}|${linea.currency}`]
        const monto = texto ? aMonto(texto, linea.currency) : null
        return {
          method: linea.method,
          currency: linea.currency,
          amount: (monto?.amount ?? 0n).toString(),
        }
      })

      const data = await api.post<{ session: CashSessionJson }>(`/cash/${sesion.sessionId}/close`, { counted })
      setSesion(data.session)
      setConteo({})
    } catch (fallo) {
      setError(fallo instanceof ApiError ? fallo.message : 'No se pudo cerrar la caja.')
    } finally {
      setOcupado(false)
    }
  }

  if (cargando) return <p className="p-10 text-center text-sm text-apagado">Cargando…</p>

  if (!sesion) {
    return (
      <div className="mx-auto max-w-md pt-10">
        <Tarjeta className="p-6 text-center">
          <h2 className="text-lg font-semibold">Caja cerrada</h2>
          <p className="mt-2 text-sm text-apagado">
            Abra el turno para que las ventas queden asociadas a él y el arqueo pueda cuadrar.
          </p>
          {error ? <div className="mt-4">{<Aviso>{error}</Aviso>}</div> : null}
          <Boton variante="principal" className="mt-5 w-full" disabled={ocupado} onClick={() => void abrir()}>
            {ocupado ? 'Abriendo…' : 'Abrir caja'}
          </Boton>
        </Tarjeta>
      </div>
    )
  }

  const cerrada = sesion.closedAt !== null

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col gap-4">
      <Tarjeta className="flex items-center justify-between px-4 py-3">
        <div>
          <span className="block text-sm font-medium">{cerrada ? 'Turno cerrado' : 'Turno abierto'}</span>
          <span className="block text-xs text-apagado">
            Desde {new Date(sesion.openedAt).toLocaleString('es-VE')} · {sesion.documentCount} documento
            {sesion.documentCount === 1 ? '' : 's'}
          </span>
        </div>
        {!cerrada ? (
          <Boton variante="principal" disabled={ocupado} onClick={() => void cerrar()}>
            {ocupado ? 'Cerrando…' : 'Cerrar y cuadrar'}
          </Boton>
        ) : (
          <Boton disabled={ocupado} onClick={() => void abrir()}>
            Abrir nuevo turno
          </Boton>
        )}
      </Tarjeta>

      {error ? <Aviso>{error}</Aviso> : null}

      <Tarjeta className="min-h-0 flex-1 overflow-auto">
        {sesion.lines.length === 0 ? (
          <Vacio>Todavía no hay movimientos en este turno.</Vacio>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 border-b border-borde bg-white text-xs text-apagado">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Medio</th>
                <th className="w-36 px-2 py-2 text-right font-medium">Debería haber</th>
                <th className="w-36 px-2 py-2 text-right font-medium">Contado</th>
                <th className="w-32 px-4 py-2 text-right font-medium">Diferencia</th>
              </tr>
            </thead>
            <tbody>
              {sesion.lines.map((linea) => {
                const clave = `${linea.method}|${linea.currency}`
                const diferencia = toMoney(linea.difference)
                return (
                  <tr key={clave} className="border-b border-borde/60 last:border-0">
                    <td className="px-4 py-2">
                      <span className="block font-medium">{NOMBRES[linea.method] ?? linea.method}</span>
                      {BigInt(linea.opening.amount) > 0n ? (
                        <span className="cifra block text-xs text-apagado">
                          fondo {formatMoney(toMoney(linea.opening))}
                        </span>
                      ) : null}
                    </td>
                    <td className="cifra px-2 py-2 text-right">{formatMoney(toMoney(linea.expected))}</td>
                    <td className="px-2 py-2 text-right">
                      {cerrada ? (
                        <span className="cifra">{formatMoney(toMoney(linea.counted))}</span>
                      ) : (
                        <input
                          value={conteo[clave] ?? ''}
                          onChange={(e) => setConteo((actual) => ({ ...actual, [clave]: e.target.value }))}
                          placeholder="0,00"
                          className="cifra w-full rounded border border-borde px-2 py-1 text-right outline-none focus:border-acento"
                        />
                      )}
                    </td>
                    <td
                      className={`cifra px-4 py-2 text-right ${
                        cerrada && diferencia.amount !== 0n
                          ? diferencia.amount < 0n
                            ? 'font-medium text-error'
                            : 'font-medium text-alerta'
                          : 'text-apagado'
                      }`}
                    >
                      {cerrada ? formatMoney(diferencia) : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Tarjeta>

      {cerrada ? (
        <Aviso
          tipo={sesion.lines.every((l) => BigInt(l.difference.amount) === 0n) ? 'exito' : 'alerta'}
        >
          {sesion.lines.every((l) => BigInt(l.difference.amount) === 0n)
            ? 'El turno cuadró exactamente.'
            : 'Hay diferencias. Quedan registradas tal como se contaron: no se ajustan para que cuadre.'}
        </Aviso>
      ) : (
        <p className="text-center text-xs text-apagado">
          Cuente el dinero y escriba lo que hay. La diferencia se guarda tal cual — un descuadre visible es
          información.
        </p>
      )}
    </div>
  )
}
