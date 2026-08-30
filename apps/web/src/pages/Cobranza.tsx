import { useCallback, useEffect, useState } from 'react'
import { formatMoney } from '@fve/money'

import { ApiError, api, fromMoney, toMoney, type MoneyJson } from '../api'
import { aMonto } from '../formato'
import { Aviso, Boton, Campo, Tarjeta, Vacio } from '../components/ui'

type Estado = 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'CANCELLED'
type Periodo = 'MENSUAL' | 'SEMESTRAL' | 'ANUAL'

interface SuscripcionJson {
  tenantId: string
  tenantName: string
  rif: string
  status: Estado
  period: Periodo
  price: MoneyJson
  paidThrough: string
  graceDays: number
  daysLeft: number
  suspended: boolean
  lastPaymentAt: string | null
}

interface PagoJson {
  receivedAt: string
  amount: MoneyJson
  method: string
  reference: string | null
  paidThroughAfter: string
}

const ETIQUETAS: Record<Estado, { texto: string; clase: string }> = {
  TRIAL: { texto: 'prueba', clase: 'bg-acento/10 text-acento' },
  ACTIVE: { texto: 'al día', clase: 'bg-exito/10 text-exito' },
  PAST_DUE: { texto: 'vencido', clase: 'bg-alerta/10 text-alerta' },
  SUSPENDED: { texto: 'suspendido', clase: 'bg-error/10 text-error' },
  CANCELLED: { texto: 'cancelado', clase: 'bg-borde text-apagado' },
}

const MEDIOS = ['PAGO_MOVIL', 'ZELLE', 'USDT', 'TRANSFERENCIA_BS', 'EFECTIVO_USD', 'EFECTIVO_BS'] as const

const NOMBRES: Record<string, string> = {
  PAGO_MOVIL: 'Pago móvil',
  ZELLE: 'Zelle',
  USDT: 'USDT',
  TRANSFERENCIA_BS: 'Transferencia',
  EFECTIVO_USD: 'Efectivo divisa',
  EFECTIVO_BS: 'Efectivo Bs',
}

/**
 * Panel de cobranza.
 *
 * Ordenado por lo que vence primero, que es la lista de a quién hay que llamar
 * hoy. Los días restantes se muestran siempre: un número es más accionable que
 * una fecha que hay que restar de cabeza.
 */
export function Cobranza() {
  const [filas, setFilas] = useState<SuscripcionJson[]>([])
  const [error, setError] = useState<string | null>(null)
  const [cobrando, setCobrando] = useState<SuscripcionJson | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    try {
      const data = await api.get<{ subscriptions: SuscripcionJson[] }>('/platform/subscriptions')
      setFilas(data.subscriptions)
      setError(null)
    } catch (fallo) {
      setError(fallo instanceof ApiError ? fallo.message : 'No se pudo cargar la cobranza.')
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  async function correrCorte() {
    setAviso(null)
    try {
      const data = await api.post<{ result: { suspendidos: string[]; enGracia: string[] } }>(
        '/platform/subscriptions/enforce',
      )
      setAviso(
        `${data.result.suspendidos.length} suspendido${data.result.suspendidos.length === 1 ? '' : 's'}, ` +
          `${data.result.enGracia.length} en gracia.`,
      )
      await cargar()
    } catch (fallo) {
      setError(fallo instanceof ApiError ? fallo.message : 'No se pudo revisar la cobranza.')
    }
  }

  const porVencer = filas.filter((fila) => fila.daysLeft <= 7 && !fila.suspended).length
  const cobradoMes = filas.filter((fila) => fila.status === 'ACTIVE').length

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Cobranza</h1>
          <p className="text-sm text-apagado">
            {filas.length} negocio{filas.length === 1 ? '' : 's'} · {cobradoMes} al día
            {porVencer > 0 ? ` · ${porVencer} por vencer` : ''}
          </p>
        </div>
        <Boton onClick={() => void correrCorte()}>Revisar vencimientos</Boton>
      </div>

      {error ? <Aviso>{error}</Aviso> : null}
      {aviso ? <Aviso tipo="exito">{aviso}</Aviso> : null}

      <Tarjeta className="min-h-0 flex-1 overflow-auto">
        {filas.length === 0 ? (
          <Vacio>Todavía no hay negocios con suscripción.</Vacio>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 border-b border-borde bg-white text-xs text-apagado">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Negocio</th>
                <th className="w-28 px-2 py-2 text-center font-medium">Estado</th>
                <th className="w-28 px-2 py-2 text-right font-medium">Vence</th>
                <th className="w-24 px-2 py-2 text-right font-medium">Días</th>
                <th className="w-24 px-2 py-2 text-right font-medium">Plan</th>
                <th className="w-36" />
              </tr>
            </thead>
            <tbody>
              {filas.map((fila) => {
                const etiqueta = ETIQUETAS[fila.status]
                return (
                  <tr key={fila.tenantId} className="border-b border-borde/60 last:border-0">
                    <td className="px-4 py-2">
                      <span className="block font-medium">{fila.tenantName}</span>
                      <span className="cifra block text-xs text-apagado">{fila.rif}</span>
                    </td>
                    <td className="px-2 py-2 text-center">
                      <span className={`rounded-full px-2 py-0.5 text-xs ${etiqueta.clase}`}>
                        {etiqueta.texto}
                      </span>
                    </td>
                    <td className="cifra px-2 py-2 text-right">{fila.paidThrough}</td>
                    <td
                      className={`cifra px-2 py-2 text-right ${
                        fila.daysLeft < 0
                          ? 'font-medium text-error'
                          : fila.daysLeft <= 7
                            ? 'font-medium text-alerta'
                            : ''
                      }`}
                    >
                      {fila.daysLeft < 0 ? `${-fila.daysLeft} vencidos` : fila.daysLeft}
                    </td>
                    <td className="cifra px-2 py-2 text-right">{formatMoney(toMoney(fila.price))}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-right">
                      <Boton variante="plano" onClick={() => setCobrando(fila)}>
                        Registrar pago
                      </Boton>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Tarjeta>

      <p className="text-center text-xs text-apagado">
        El corte corre solo cada hora. Quien vence entra primero en gracia — es a quién llamar antes de
        cortarle — y solo se suspende si la pasa.
      </p>

      {cobrando ? (
        <RegistrarPago
          fila={cobrando}
          onCerrar={() => setCobrando(null)}
          onRegistrado={() => {
            setCobrando(null)
            void cargar()
          }}
        />
      ) : null}
    </div>
  )
}

function RegistrarPago({
  fila,
  onCerrar,
  onRegistrado,
}: {
  fila: SuscripcionJson
  onCerrar: () => void
  onRegistrado: () => void
}) {
  const [moneda, setMoneda] = useState<'USD' | 'VES'>('USD')
  const [texto, setTexto] = useState(() => {
    const monto = toMoney(fila.price)
    return `${monto.amount / 100n},${(monto.amount % 100n).toString().padStart(2, '0')}`
  })
  const [metodo, setMetodo] = useState<(typeof MEDIOS)[number]>('PAGO_MOVIL')
  const [referencia, setReferencia] = useState('')
  const [periodos, setPeriodos] = useState(1)
  const [historial, setHistorial] = useState<PagoJson[]>([])
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    void api
      .get<{ payments: PagoJson[] }>(`/platform/tenants/${fila.tenantId}/subscription`)
      .then((data) => setHistorial(data.payments))
      .catch(() => setHistorial([]))
  }, [fila.tenantId])

  const monto = aMonto(texto, moneda)

  async function guardar() {
    if (!monto) {
      setError('El monto no se entiende.')
      return
    }

    setError(null)
    setEnviando(true)
    try {
      await api.post(`/platform/tenants/${fila.tenantId}/subscription/payments`, {
        amount: fromMoney(monto),
        method: metodo,
        periods: periodos,
        ...(referencia.trim() ? { reference: referencia.trim() } : {}),
      })
      onRegistrado()
    } catch (fallo) {
      setError(fallo instanceof ApiError ? fallo.message : 'No se pudo registrar el pago.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-tinta/30 p-6">
      <Tarjeta className="w-full max-w-lg p-5">
        <h2 className="text-lg font-semibold">Pago de {fila.tenantName}</h2>
        <p className="mt-1 text-sm text-apagado">
          Vence el {fila.paidThrough} · plan {fila.period.toLowerCase()} de {formatMoney(toMoney(fila.price))}
        </p>

        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-[90px_1fr_90px] gap-3">
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Moneda</span>
              <select
                value={moneda}
                onChange={(e) => setMoneda(e.target.value as 'USD' | 'VES')}
                className="w-full rounded-lg border border-borde bg-white px-3 py-2 text-sm outline-none focus:border-acento"
              >
                <option value="USD">$</option>
                <option value="VES">Bs</option>
              </select>
            </label>
            <Campo
              etiqueta="Monto recibido"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              className="cifra text-right"
              autoFocus
            />
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Períodos</span>
              <input
                type="number"
                min={1}
                max={24}
                value={periodos}
                onChange={(e) => setPeriodos(Math.max(1, Number(e.target.value) || 1))}
                className="cifra w-full rounded-lg border border-borde bg-white px-3 py-2 text-right text-sm outline-none focus:border-acento"
              />
            </label>
          </div>

          <div className="flex flex-wrap gap-1">
            {MEDIOS.map((medio) => (
              <button
                key={medio}
                onClick={() => setMetodo(medio)}
                className={`rounded-md border px-2.5 py-1 text-xs transition ${
                  metodo === medio
                    ? 'border-acento bg-acento/10 font-medium text-acento'
                    : 'border-borde text-apagado hover:text-tinta'
                }`}
              >
                {NOMBRES[medio]}
              </button>
            ))}
          </div>

          <Campo
            etiqueta="Referencia"
            value={referencia}
            onChange={(e) => setReferencia(e.target.value)}
            ayuda="Es lo único que permite reconstruir una cobranza discutida."
          />

          {error ? <Aviso>{error}</Aviso> : null}

          {historial.length > 0 ? (
            <div>
              <span className="mb-1 block text-xs font-medium text-apagado">Pagos anteriores</span>
              <ul className="max-h-32 space-y-1 overflow-auto">
                {historial.map((pago, indice) => (
                  <li
                    key={indice}
                    className="flex items-center justify-between rounded-md bg-papel px-3 py-1.5 text-xs"
                  >
                    <span>
                      {new Date(pago.receivedAt).toLocaleDateString('es-VE')} · {NOMBRES[pago.method] ?? pago.method}
                      {pago.reference ? ` · ${pago.reference}` : ''}
                    </span>
                    <span className="cifra">{formatMoney(toMoney(pago.amount))}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="flex justify-end gap-2 pt-2">
            <Boton variante="plano" onClick={onCerrar}>
              Cancelar
            </Boton>
            <Boton variante="principal" disabled={enviando || !monto} onClick={() => void guardar()}>
              {enviando ? 'Guardando…' : 'Registrar pago'}
            </Boton>
          </div>
        </div>
      </Tarjeta>
    </div>
  )
}
