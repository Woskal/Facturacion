import { useCallback, useEffect, useState } from 'react'
import { formatMoney, money, type Money } from '@fve/money'

import { ApiError, api, fromMoney, toMoney, type ExpenseJson } from '../api'
import { aMonto } from '../formato'
import { Aviso, Boton, Campo, Encabezado, Insignia, Modal, Select, Tarjeta, Vacio } from '../components/ui'

const MEDIOS = [
  { method: '', nombre: 'Sin especificar' },
  { method: 'EFECTIVO_BS', nombre: 'Efectivo Bs' },
  { method: 'EFECTIVO_USD', nombre: 'Efectivo divisa' },
  { method: 'PAGO_MOVIL', nombre: 'Pago móvil' },
  { method: 'TRANSFERENCIA_BS', nombre: 'Transferencia' },
  { method: 'ZELLE', nombre: 'Zelle' },
  { method: 'USDT', nombre: 'USDT' },
] as const

const NOMBRE_MEDIO: Record<string, string> = Object.fromEntries(MEDIOS.map((m) => [m.method, m.nombre]))

export function Gastos() {
  const [gastos, setGastos] = useState<ExpenseJson[]>([])
  const [error, setError] = useState<string | null>(null)
  const [creando, setCreando] = useState(false)

  const cargar = useCallback(async () => {
    try {
      const d = await api.get<{ expenses: ExpenseJson[] }>('/expenses?limit=200')
      setGastos(d.expenses)
      setError(null)
    } catch (fallo) {
      setError(fallo instanceof ApiError ? fallo.message : 'No se pudieron cargar los gastos.')
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const total = gastos.reduce<Money>((acc, g) => money('VES', acc.amount + toMoney(g.amountVes).amount), money('VES', 0n))

  return (
    <div className="mx-auto flex h-full max-w-4xl flex-col gap-4">
      <Encabezado titulo="Gastos" subtitulo="Egresos del negocio, para ver la ganancia real">
        <Boton variante="principal" onClick={() => setCreando(true)}>
          Nuevo gasto
        </Boton>
      </Encabezado>

      {error ? <Aviso>{error}</Aviso> : null}

      {gastos.length > 0 ? (
        <Tarjeta className="flex items-center justify-between px-4 py-3">
          <span className="text-sm text-apagado">Total de los últimos {gastos.length} gastos</span>
          <span className="cifra text-lg font-semibold text-tinta">{formatMoney(total)}</span>
        </Tarjeta>
      ) : null}

      <Tarjeta className="min-h-0 flex-1 overflow-auto">
        {gastos.length === 0 ? (
          <Vacio>Todavía no hay gastos registrados.</Vacio>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 border-b border-borde bg-lienzo text-xs uppercase tracking-wide text-apagado">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium">Concepto</th>
                <th className="px-2 py-2.5 text-left font-medium">Medio</th>
                <th className="w-28 px-2 py-2.5 text-right font-medium">Fecha</th>
                <th className="w-32 px-4 py-2.5 text-right font-medium">Monto</th>
              </tr>
            </thead>
            <tbody>
              {gastos.map((g) => (
                <tr key={g.expenseId} className="border-b border-borde/60 last:border-0">
                  <td className="px-4 py-2.5">
                    <span className="block text-tinta">{g.description}</span>
                    {g.category ? <Insignia>{g.category}</Insignia> : null}
                  </td>
                  <td className="px-2 py-2.5 text-apagado">{g.paidWith ? NOMBRE_MEDIO[g.paidWith] ?? g.paidWith : '—'}</td>
                  <td className="cifra px-2 py-2.5 text-right text-apagado">
                    {new Date(g.occurredAt).toLocaleDateString('es-VE')}
                  </td>
                  <td className="cifra px-4 py-2.5 text-right">
                    <span className="block font-medium text-tinta">{formatMoney(toMoney(g.amountVes))}</span>
                    {g.currency === 'USD' ? (
                      <span className="block text-xs text-apagado">{formatMoney(toMoney(g.amount))}</span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Tarjeta>

      {creando ? (
        <NuevoGasto
          onCerrar={() => setCreando(false)}
          onCreado={() => {
            setCreando(false)
            void cargar()
          }}
        />
      ) : null}
    </div>
  )
}

function NuevoGasto({ onCerrar, onCreado }: { onCerrar: () => void; onCreado: () => void }) {
  const [description, setDescription] = useState('')
  const [categoria, setCategoria] = useState('')
  const [moneda, setMoneda] = useState<'VES' | 'USD'>('VES')
  const [texto, setTexto] = useState('')
  const [medio, setMedio] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function guardar() {
    const monto = aMonto(texto, moneda)
    if (!monto) {
      setError('El monto no se entiende.')
      return
    }
    setEnviando(true)
    setError(null)
    try {
      await api.post('/expenses', {
        description: description.trim(),
        ...(categoria.trim() ? { categoryName: categoria.trim() } : {}),
        currency: moneda,
        amount: fromMoney(monto),
        ...(medio ? { paidWith: medio } : {}),
      })
      onCreado()
    } catch (fallo) {
      setError(fallo instanceof ApiError ? fallo.message : 'No se pudo registrar el gasto.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Modal titulo="Nuevo gasto" onCerrar={onCerrar}>
      <div className="space-y-3">
        <Campo etiqueta="Concepto" value={description} onChange={(e) => setDescription(e.target.value)} autoFocus />
        <Campo
          etiqueta="Categoría"
          value={categoria}
          onChange={(e) => setCategoria(e.target.value)}
          placeholder="Alquiler, servicios, sueldos… (opcional)"
          ayuda="Se reutiliza: si el nombre ya existe, se enlaza."
        />
        <div className="grid grid-cols-[90px_1fr] gap-3">
          <Select etiqueta="Moneda" value={moneda} onChange={(e) => setMoneda(e.target.value as 'VES' | 'USD')}>
            <option value="VES">Bs</option>
            <option value="USD">$</option>
          </Select>
          <Campo etiqueta="Monto" value={texto} onChange={(e) => setTexto(e.target.value)} className="cifra text-right" />
        </div>
        <Select etiqueta="Medio de pago" value={medio} onChange={(e) => setMedio(e.target.value)}>
          {MEDIOS.map((m) => (
            <option key={m.method} value={m.method}>
              {m.nombre}
            </option>
          ))}
        </Select>

        {error ? <Aviso>{error}</Aviso> : null}

        <div className="flex justify-end gap-2 pt-1">
          <Boton variante="plano" onClick={onCerrar}>
            Cancelar
          </Boton>
          <Boton
            variante="principal"
            disabled={enviando || description.trim() === '' || texto.trim() === ''}
            onClick={() => void guardar()}
          >
            {enviando ? 'Guardando…' : 'Registrar gasto'}
          </Boton>
        </div>
      </div>
    </Modal>
  )
}
