import { useCallback, useEffect, useState } from 'react'
import { formatMoney } from '@fve/money'

import { ApiError, api, fromMoney, toMoney, type MoneyJson } from '../api'
import { aMonto } from '../formato'
import { Aviso, Boton, Campo, Encabezado, Insignia, Modal, Select, Tarjeta, Vacio } from '../components/ui'

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

const ETIQUETAS: Record<Estado, { texto: string; tono: 'neutro' | 'acento' | 'exito' | 'alerta' | 'error' }> = {
  TRIAL: { texto: 'prueba', tono: 'acento' },
  ACTIVE: { texto: 'al día', tono: 'exito' },
  PAST_DUE: { texto: 'vencido', tono: 'alerta' },
  SUSPENDED: { texto: 'suspendido', tono: 'error' },
  CANCELLED: { texto: 'cancelado', tono: 'neutro' },
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
      <Encabezado
        titulo="Cobranza"
        subtitulo={`${filas.length} negocio${filas.length === 1 ? '' : 's'} · ${cobradoMes} al día${
          porVencer > 0 ? ` · ${porVencer} por vencer` : ''
        }`}
      >
        <Boton onClick={() => void correrCorte()}>Revisar vencimientos</Boton>
      </Encabezado>

      {error ? <Aviso>{error}</Aviso> : null}
      {aviso ? <Aviso tipo="exito">{aviso}</Aviso> : null}

      <Tarjeta className="min-h-0 flex-1 overflow-auto">
        {filas.length === 0 ? (
          <Vacio>Todavía no hay negocios con suscripción.</Vacio>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 border-b border-borde bg-lienzo text-xs uppercase tracking-wide text-apagado">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium">Negocio</th>
                <th className="w-28 px-2 py-2.5 text-center font-medium">Estado</th>
                <th className="w-28 px-2 py-2.5 text-right font-medium">Vence</th>
                <th className="w-24 px-2 py-2.5 text-right font-medium">Días</th>
                <th className="w-24 px-2 py-2.5 text-right font-medium">Plan</th>
                <th className="w-36" />
              </tr>
            </thead>
            <tbody>
              {filas.map((fila) => {
                const etiqueta = ETIQUETAS[fila.status]
                return (
                  <tr key={fila.tenantId} className="border-b border-borde/60 transition last:border-0 hover:bg-tenue/50">
                    <td className="px-4 py-2.5">
                      <span className="block font-medium text-tinta">{fila.tenantName}</span>
                      <span className="cifra block text-xs text-apagado">{fila.rif}</span>
                    </td>
                    <td className="px-2 py-2.5 text-center">
                      <Insignia tono={etiqueta.tono}>{etiqueta.texto}</Insignia>
                    </td>
                    <td className="cifra px-2 py-2.5 text-right text-tinta">{fila.paidThrough}</td>
                    <td
                      className={`cifra px-2 py-2.5 text-right ${
                        fila.daysLeft < 0
                          ? 'font-medium text-error'
                          : fila.daysLeft <= 7
                            ? 'font-medium text-alerta'
                            : 'text-tinta'
                      }`}
                    >
                      {fila.daysLeft < 0 ? `${-fila.daysLeft} vencidos` : fila.daysLeft}
                    </td>
                    <td className="cifra px-2 py-2.5 text-right text-tinta">{formatMoney(toMoney(fila.price))}</td>
                    <td className="whitespace-nowrap px-2 py-2.5 text-right">
                      <Boton variante="suave" tamano="sm" onClick={() => setCobrando(fila)}>
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
    <Modal
      titulo="Registrar pago"
      descripcion={`${fila.tenantName} · vence ${fila.paidThrough} · plan ${fila.period.toLowerCase()} de ${formatMoney(toMoney(fila.price))}`}
      onCerrar={onCerrar}
      ancho="lg"
    >
      <div className="space-y-3">
        <div className="grid grid-cols-[90px_1fr_90px] gap-3">
          <Select etiqueta="Moneda" value={moneda} onChange={(e) => setMoneda(e.target.value as 'USD' | 'VES')}>
            <option value="USD">$</option>
            <option value="VES">Bs</option>
          </Select>
          <Campo
            etiqueta="Monto recibido"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            className="cifra text-right"
            autoFocus
          />
          <Campo
            etiqueta="Períodos"
            type="number"
            min={1}
            max={24}
            value={periodos}
            onChange={(e) => setPeriodos(Math.max(1, Number(e.target.value) || 1))}
            className="cifra text-right"
          />
        </div>

        <div>
          <span className="mb-1.5 block text-sm font-medium text-tinta">Medio de pago</span>
          <div className="flex flex-wrap gap-1.5">
            {MEDIOS.map((medio) => (
              <button
                key={medio}
                type="button"
                onClick={() => setMetodo(medio)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                  metodo === medio
                    ? 'border-acento bg-acento-tenue text-acento'
                    : 'border-borde text-apagado hover:text-tinta'
                }`}
              >
                {NOMBRES[medio]}
              </button>
            ))}
          </div>
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
            <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-apagado">Pagos anteriores</span>
            <ul className="max-h-32 space-y-1 overflow-auto">
              {historial.map((pago, indice) => (
                <li
                  key={indice}
                  className="flex items-center justify-between rounded-lg bg-tenue px-3 py-1.5 text-xs"
                >
                  <span className="text-apagado">
                    {new Date(pago.receivedAt).toLocaleDateString('es-VE')} · {NOMBRES[pago.method] ?? pago.method}
                    {pago.reference ? ` · ${pago.reference}` : ''}
                  </span>
                  <span className="cifra font-medium text-tinta">{formatMoney(toMoney(pago.amount))}</span>
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
    </Modal>
  )
}
