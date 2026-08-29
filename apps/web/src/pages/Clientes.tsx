import { useCallback, useEffect, useState } from 'react'
import { convert, formatMoney, type Money, type Rate } from '@fve/money'

import { ApiError, api, fromMoney, toMoney, type CustomerJson, type MoneyJson } from '../api'
import { aMonto } from '../formato'
import { Aviso, Boton, Campo, Tarjeta, Vacio } from '../components/ui'

interface ReceivableJson {
  receivableId: string
  documentId: string
  fullNumber: string
  customerId: string
  customerName: string
  currency: 'VES' | 'USD'
  original: MoneyJson
  paid: MoneyJson
  balance: MoneyJson
  settled: boolean
}

const TIPOS_ABONO = [
  { kind: 'PAYMENT', nombre: 'Pago' },
  { kind: 'RETENTION_IVA', nombre: 'Retención de IVA' },
  { kind: 'RETENTION_ISLR', nombre: 'Retención de ISLR' },
  { kind: 'WRITE_OFF', nombre: 'Descargo' },
] as const

export function Clientes({ rate }: { rate: Rate }) {
  const [clientes, setClientes] = useState<CustomerJson[]>([])
  const [cartera, setCartera] = useState<ReceivableJson[]>([])
  const [busqueda, setBusqueda] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [creando, setCreando] = useState(false)
  const [abonando, setAbonando] = useState<ReceivableJson | null>(null)

  const cargar = useCallback(async () => {
    try {
      const [personas, pendientes] = await Promise.all([
        api.get<{ customers: CustomerJson[] }>(`/customers?q=${encodeURIComponent(busqueda.trim())}&limit=200`),
        api.get<{ receivables: ReceivableJson[] }>('/receivables'),
      ])
      setClientes(personas.customers)
      setCartera(pendientes.receivables)
      setError(null)
    } catch (fallo) {
      setError(fallo instanceof ApiError ? fallo.message : 'No se pudieron cargar los clientes.')
    }
  }, [busqueda])

  useEffect(() => {
    const temporizador = setTimeout(() => void cargar(), 150)
    return () => clearTimeout(temporizador)
  }, [cargar])

  const totalPorCobrar = cartera.reduce<Money | null>((acumulado, fila) => {
    const enBs = convert(toMoney(fila.balance), 'VES', rate)
    return acumulado
      ? { currency: 'VES' as const, amount: acumulado.amount + enBs.amount }
      : enBs
  }, null)

  return (
    <div className="mx-auto grid h-full max-w-5xl grid-rows-[auto_1fr_auto] gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-64 flex-1">
          <Campo
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por nombre o cédula…"
          />
        </div>
        <Boton variante="principal" onClick={() => setCreando(true)}>
          Nuevo cliente
        </Boton>
      </div>

      {error ? <Aviso>{error}</Aviso> : null}

      <div className="grid min-h-0 grid-cols-1 gap-4 lg:grid-cols-2">
        <Tarjeta className="min-h-0 overflow-auto">
          <h2 className="sticky top-0 border-b border-borde bg-white px-4 py-2 text-xs font-medium text-apagado">
            Clientes
          </h2>
          {clientes.length === 0 ? (
            <Vacio>Ningún cliente coincide.</Vacio>
          ) : (
            <ul>
              {clientes.map((cliente) => (
                <li
                  key={cliente.customerId}
                  className="flex items-center justify-between gap-3 border-b border-borde/60 px-4 py-2 text-sm last:border-0"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{cliente.name}</span>
                    <span className="block text-xs text-apagado">
                      {cliente.id}
                      {cliente.phone ? ` · ${cliente.phone}` : ''}
                      {cliente.specialTaxpayer ? ' · contribuyente especial' : ''}
                    </span>
                  </span>
                  {cliente.openReceivables > 0 ? (
                    <span className="shrink-0 rounded-full bg-alerta/10 px-2 py-0.5 text-xs text-alerta">
                      {cliente.openReceivables} por cobrar
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Tarjeta>

        <Tarjeta className="min-h-0 overflow-auto">
          <h2 className="sticky top-0 border-b border-borde bg-white px-4 py-2 text-xs font-medium text-apagado">
            Por cobrar
          </h2>
          {cartera.length === 0 ? (
            <Vacio>No hay nada pendiente de cobro.</Vacio>
          ) : (
            <ul>
              {cartera.map((fila) => (
                <li
                  key={fila.receivableId}
                  className="flex items-center justify-between gap-3 border-b border-borde/60 px-4 py-2 text-sm last:border-0"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{fila.customerName}</span>
                    <span className="block text-xs text-apagado">{fila.fullNumber}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    <span className="cifra text-right">
                      <span className="block font-medium">
                        {formatMoney(convert(toMoney(fila.balance), 'VES', rate))}
                      </span>
                      <span className="block text-xs text-apagado">{formatMoney(toMoney(fila.balance))}</span>
                    </span>
                    <Boton variante="plano" onClick={() => setAbonando(fila)}>
                      Abonar
                    </Boton>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Tarjeta>
      </div>

      {totalPorCobrar ? (
        <Tarjeta className="flex items-center justify-between px-4 py-3">
          <span className="text-sm text-apagado">Total por cobrar</span>
          <span className="cifra text-lg font-semibold">{formatMoney(totalPorCobrar)}</span>
        </Tarjeta>
      ) : null}

      {creando ? (
        <NuevoCliente
          onCerrar={() => setCreando(false)}
          onCreado={() => {
            setCreando(false)
            void cargar()
          }}
        />
      ) : null}

      {abonando ? (
        <Abonar
          fila={abonando}
          rate={rate}
          onCerrar={() => setAbonando(null)}
          onAbonado={() => {
            setAbonando(null)
            void cargar()
          }}
        />
      ) : null}
    </div>
  )
}

function Modal({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-tinta/30 p-6">
      <Tarjeta className="w-full max-w-md p-5">
        <h2 className="mb-4 text-lg font-semibold">{titulo}</h2>
        {children}
      </Tarjeta>
    </div>
  )
}

function NuevoCliente({ onCerrar, onCreado }: { onCerrar: () => void; onCreado: () => void }) {
  const [idKind, setIdKind] = useState<'V' | 'E' | 'J' | 'G' | 'P'>('V')
  const [idNumber, setIdNumber] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [especial, setEspecial] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function guardar() {
    setError(null)
    setEnviando(true)
    try {
      await api.post('/customers', {
        idKind,
        idNumber: idNumber.trim(),
        name: name.trim(),
        ...(phone.trim() ? { phone: phone.trim() } : {}),
        specialTaxpayer: especial,
      })
      onCreado()
    } catch (fallo) {
      setError(fallo instanceof ApiError ? fallo.message : 'No se pudo crear el cliente.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Modal titulo="Nuevo cliente">
      <div className="space-y-3">
        <Campo etiqueta="Nombre" value={name} onChange={(e) => setName(e.target.value)} autoFocus />

        <div className="grid grid-cols-[80px_1fr] gap-3">
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Tipo</span>
            <select
              value={idKind}
              onChange={(e) => setIdKind(e.target.value as typeof idKind)}
              className="w-full rounded-lg border border-borde bg-white px-3 py-2 text-sm outline-none focus:border-acento"
            >
              {(['V', 'E', 'J', 'G', 'P'] as const).map((letra) => (
                <option key={letra} value={letra}>
                  {letra}
                </option>
              ))}
            </select>
          </label>
          <Campo
            etiqueta="Cédula o RIF"
            value={idNumber}
            onChange={(e) => setIdNumber(e.target.value)}
            className="cifra"
          />
        </div>

        <Campo etiqueta="Teléfono" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="opcional" />

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={especial}
            onChange={(e) => setEspecial(e.target.checked)}
            className="mt-1"
          />
          <span>
            Contribuyente especial
            <span className="block text-xs text-apagado">Retiene IVA al pagar, así que su cuenta se salda en parte con retenciones.</span>
          </span>
        </label>

        {error ? <Aviso>{error}</Aviso> : null}

        <div className="flex justify-end gap-2 pt-2">
          <Boton variante="plano" onClick={onCerrar}>
            Cancelar
          </Boton>
          <Boton
            variante="principal"
            disabled={enviando || name.trim() === '' || idNumber.trim() === ''}
            onClick={() => void guardar()}
          >
            {enviando ? 'Guardando…' : 'Crear'}
          </Boton>
        </div>
      </div>
    </Modal>
  )
}

function Abonar({
  fila,
  rate,
  onCerrar,
  onAbonado,
}: {
  fila: ReceivableJson
  rate: Rate
  onCerrar: () => void
  onAbonado: () => void
}) {
  const [tipo, setTipo] = useState<(typeof TIPOS_ABONO)[number]['kind']>('PAYMENT')
  const [moneda, setMoneda] = useState<'VES' | 'USD'>('VES')
  const [texto, setTexto] = useState('')
  const [referencia, setReferencia] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  const saldo = toMoney(fila.balance)
  const monto = aMonto(texto, moneda)

  async function guardar() {
    if (!monto) {
      setError('El monto no se entiende.')
      return
    }

    setError(null)
    setEnviando(true)
    try {
      await api.post(`/receivables/${fila.receivableId}/entries`, {
        kind: tipo,
        amount: fromMoney(monto),
        ...(referencia.trim()
          ? tipo === 'PAYMENT'
            ? { reference: referencia.trim() }
            : { retentionNumber: referencia.trim() }
          : {}),
      })
      onAbonado()
    } catch (fallo) {
      setError(fallo instanceof ApiError ? fallo.message : 'No se pudo registrar el abono.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Modal titulo={`Abonar a ${fila.customerName}`}>
      <div className="mb-4 flex items-baseline justify-between rounded-lg bg-papel px-3 py-2">
        <span className="text-sm text-apagado">Saldo de {fila.fullNumber}</span>
        <span className="cifra text-right">
          <span className="block font-medium">{formatMoney(convert(saldo, 'VES', rate))}</span>
          <span className="block text-xs text-apagado">{formatMoney(saldo)}</span>
        </span>
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap gap-1">
          {TIPOS_ABONO.map((opcion) => (
            <button
              key={opcion.kind}
              onClick={() => setTipo(opcion.kind)}
              className={`rounded-md border px-2.5 py-1 text-xs transition ${
                tipo === opcion.kind
                  ? 'border-acento bg-acento/10 font-medium text-acento'
                  : 'border-borde text-apagado hover:text-tinta'
              }`}
            >
              {opcion.nombre}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-[90px_1fr] gap-3">
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Moneda</span>
            <select
              value={moneda}
              onChange={(e) => setMoneda(e.target.value as 'VES' | 'USD')}
              className="w-full rounded-lg border border-borde bg-white px-3 py-2 text-sm outline-none focus:border-acento"
            >
              <option value="VES">Bs</option>
              <option value="USD">$</option>
            </select>
          </label>
          <Campo
            etiqueta="Monto"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            className="cifra text-right"
            autoFocus
            ayuda={
              moneda === 'VES'
                ? 'Se descuenta de la deuda al valor de hoy, no al de cuando se vendió.'
                : undefined
            }
          />
        </div>

        <Campo
          etiqueta={tipo === 'PAYMENT' ? 'Referencia' : 'Número del comprobante'}
          value={referencia}
          onChange={(e) => setReferencia(e.target.value)}
          placeholder="opcional"
        />

        {error ? <Aviso>{error}</Aviso> : null}

        <div className="flex justify-end gap-2 pt-2">
          <Boton variante="plano" onClick={onCerrar}>
            Cancelar
          </Boton>
          <Boton variante="principal" disabled={enviando || !monto} onClick={() => void guardar()}>
            {enviando ? 'Guardando…' : 'Abonar'}
          </Boton>
        </div>
      </div>
    </Modal>
  )
}
