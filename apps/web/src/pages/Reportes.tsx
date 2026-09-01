import { useCallback, useEffect, useState } from 'react'
import { formatMoney, money, type Money } from '@fve/money'

import {
  ApiError,
  api,
  getToken,
  toMoney,
  type MoneyJson,
  type ProfitReportJson,
  type RetentionRowJson,
} from '../api'
import { cantidad } from '../formato'
import { Aviso, Boton, CabeceraTarjeta, Campo, Encabezado, Insignia, Tarjeta, Vacio } from '../components/ui'

interface FilaLibro {
  date: string
  fullNumber: string
  controlNumber: string | null
  customerName: string
  voided: boolean
  total: MoneyJson
  exempt: MoneyJson
  baseGeneral: MoneyJson
  ivaGeneral: MoneyJson
  baseReducida: MoneyJson
  ivaReducida: MoneyJson
  baseSuntuaria: MoneyJson
  ivaSuntuaria: MoneyJson
  igtf: MoneyJson
}

interface Libro {
  from: string
  to: string
  rows: FilaLibro[]
  totals: Omit<FilaLibro, 'date' | 'fullNumber' | 'controlNumber' | 'customerName' | 'voided'>
}

interface Dia {
  date: string
  documents: number
  totalVes: MoneyJson
  totalUsd: MoneyJson
}

interface Medio {
  method: string
  currency: 'VES' | 'USD'
  received: MoneyJson
  count: number
}

interface Producto {
  productId: string | null
  sku: string | null
  name: string
  quantity: string
  totalVes: MoneyJson
}

const NOMBRES: Record<string, string> = {
  EFECTIVO_BS: 'Efectivo Bs',
  EFECTIVO_USD: 'Efectivo divisa',
  PAGO_MOVIL: 'Pago móvil',
  TRANSFERENCIA_BS: 'Transferencia',
  PUNTO_VENTA: 'Punto de venta',
  ZELLE: 'Zelle',
  USDT: 'USDT',
  CREDITO: 'Crédito',
}

/** Primer y último día del mes en curso, que es el período que se declara. */
function mesActual(): { desde: string; hasta: string } {
  const hoy = new Date()
  const dos = (n: number) => String(n).padStart(2, '0')
  const año = hoy.getFullYear()
  const mes = hoy.getMonth()
  const ultimo = new Date(año, mes + 1, 0).getDate()
  return { desde: `${año}-${dos(mes + 1)}-01`, hasta: `${año}-${dos(mes + 1)}-${dos(ultimo)}` }
}

export function Reportes() {
  const inicial = mesActual()
  const [desde, setDesde] = useState(inicial.desde)
  const [hasta, setHasta] = useState(inicial.hasta)
  const [libro, setLibro] = useState<Libro | null>(null)
  const [dias, setDias] = useState<Dia[]>([])
  const [medios, setMedios] = useState<Medio[]>([])
  const [productos, setProductos] = useState<Producto[]>([])
  const [ganancia, setGanancia] = useState<ProfitReportJson | null>(null)
  const [gastos, setGastos] = useState<MoneyJson | null>(null)
  const [compras, setCompras] = useState<MoneyJson | null>(null)
  const [retenciones, setRetenciones] = useState<RetentionRowJson[]>([])
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)

  const cargar = useCallback(async () => {
    setCargando(true)
    const rango = `from=${desde}&to=${hasta}`

    try {
      const [l, d, m, p, g, x, ret, c] = await Promise.all([
        api.get<{ book: Libro }>(`/reports/sales-book?${rango}`),
        api.get<{ days: Dia[] }>(`/reports/daily-sales?${rango}`),
        api.get<{ methods: Medio[] }>(`/reports/by-method?${rango}`),
        api.get<{ products: Producto[] }>(`/reports/top-products?${rango}&limit=10`),
        api.get<{ report: ProfitReportJson }>(`/reports/profit?${rango}&limit=10`),
        api.get<{ total: MoneyJson }>(`/reports/expenses-total?${rango}`),
        api.get<{ retentions: RetentionRowJson[] }>(`/reports/retentions?${rango}`),
        api.get<{ total: MoneyJson }>(`/reports/purchases-total?${rango}`),
      ])
      setLibro(l.book)
      setDias(d.days)
      setMedios(m.methods)
      setProductos(p.products)
      setGanancia(g.report)
      setGastos(x.total)
      setRetenciones(ret.retentions)
      setCompras(c.total)
      setError(null)
    } catch (fallo) {
      setError(fallo instanceof ApiError ? fallo.message : 'No se pudieron cargar los reportes.')
    } finally {
      setCargando(false)
    }
  }, [desde, hasta])

  useEffect(() => {
    void cargar()
  }, [cargar])

  /**
   * Descarga el CSV.
   *
   * Se baja con `fetch` y no con un enlace directo porque la ruta exige la
   * cabecera de sesión, y un `<a href>` no la lleva.
   */
  async function descargar() {
    try {
      const respuesta = await fetch(`/api/reports/sales-book.csv?from=${desde}&to=${hasta}`, {
        headers: { authorization: `Bearer ${getToken() ?? ''}` },
      })
      if (!respuesta.ok) throw new Error('fallo')

      const blob = await respuesta.blob()
      const url = URL.createObjectURL(blob)
      const enlace = document.createElement('a')
      enlace.href = url
      enlace.download = `libro-de-ventas-${desde}-a-${hasta}.csv`
      enlace.click()
      URL.revokeObjectURL(url)
    } catch {
      setError('No se pudo descargar el libro.')
    }
  }

  const totalPeriodo = dias.reduce<Money>(
    (acumulado, dia) => money('VES', acumulado.amount + BigInt(dia.totalVes.amount)),
    money('VES', 0n),
  )
  const documentos = dias.reduce((acumulado, dia) => acumulado + dia.documents, 0)

  return (
    <div className="mx-auto flex h-full max-w-6xl flex-col gap-4">
      <Encabezado titulo="Reportes" subtitulo="Ventas, medios de pago y libro fiscal del período">
        <Boton variante="principal" onClick={() => void descargar()} disabled={!libro || libro.rows.length === 0}>
          Descargar libro de ventas
        </Boton>
      </Encabezado>

      <div className="flex flex-wrap items-end gap-2">
        <Campo etiqueta="Desde" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="cifra" />
        <Campo etiqueta="Hasta" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="cifra" />
        <Boton onClick={() => void cargar()} disabled={cargando}>
          {cargando ? 'Cargando…' : 'Actualizar'}
        </Boton>
      </div>

      {error ? <Aviso>{error}</Aviso> : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Resumen titulo="Vendido" valor={formatMoney(totalPeriodo)} />
        <Resumen
          titulo="Ganancia"
          valor={ganancia ? formatMoney(toMoney(ganancia.totals.profit)) : '—'}
          detalle={ganancia ? `${(ganancia.marginBps / 100).toFixed(1)}% margen` : undefined}
          tono="exito"
        />
        <Resumen
          titulo="Costo vendido"
          valor={ganancia ? formatMoney(toMoney(ganancia.totals.cost)) : '—'}
        />
        <Resumen titulo="Documentos" valor={String(documentos)} />
        <Resumen
          titulo="Base gravada"
          valor={libro ? formatMoney(toMoney(libro.totals.baseGeneral)) : '—'}
        />
        <Resumen titulo="IVA cobrado" valor={libro ? formatMoney(toMoney(libro.totals.ivaGeneral)) : '—'} />
        <Resumen titulo="Compras" valor={compras ? formatMoney(toMoney(compras)) : '—'} />
        <Resumen titulo="Gastos" valor={gastos ? formatMoney(toMoney(gastos)) : '—'} />
        <Resumen
          titulo="Ganancia neta"
          valor={
            ganancia && gastos
              ? formatMoney(money('VES', toMoney(ganancia.totals.profit).amount - toMoney(gastos).amount))
              : '—'
          }
          detalle="ganancia − gastos"
          tono="exito"
        />
      </div>

      <GraficaVentas dias={dias} />

      <div className="grid min-h-0 grid-cols-1 gap-4 lg:grid-cols-2">
        <Tarjeta className="flex min-h-0 flex-col overflow-hidden">
          <CabeceraTarjeta>Cobrado por medio de pago</CabeceraTarjeta>
          <div className="min-h-0 flex-1 overflow-auto">
            {medios.length === 0 ? (
              <Vacio>Sin cobros en el período.</Vacio>
            ) : (
              <ul>
                {medios.map((medio) => (
                  <li
                    key={`${medio.method}-${medio.currency}`}
                    className="flex items-center justify-between border-b border-borde/60 px-4 py-2.5 text-sm last:border-0"
                  >
                    <span className="text-tinta">
                      {NOMBRES[medio.method] ?? medio.method}
                      <span className="ml-2 text-xs text-apagado">{medio.count}×</span>
                    </span>
                    <span className="cifra font-medium text-tinta">{formatMoney(toMoney(medio.received))}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Tarjeta>

        <Tarjeta className="flex min-h-0 flex-col overflow-hidden">
          <CabeceraTarjeta>Lo más vendido</CabeceraTarjeta>
          <div className="min-h-0 flex-1 overflow-auto">
            {productos.length === 0 ? (
              <Vacio>Sin ventas en el período.</Vacio>
            ) : (
              <ul>
                {productos.map((producto, indice) => (
                  <li
                    key={producto.productId ?? indice}
                    className="flex items-center justify-between gap-3 border-b border-borde/60 px-4 py-2.5 text-sm last:border-0"
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <span className="cifra flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-tenue text-xs font-semibold text-apagado">
                        {indice + 1}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-tinta">{producto.name}</span>
                        <span className="cifra block text-xs text-apagado">
                          {cantidad(BigInt(producto.quantity))} vendidos
                        </span>
                      </span>
                    </span>
                    <span className="cifra shrink-0 font-medium text-tinta">{formatMoney(toMoney(producto.totalVes))}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Tarjeta>
      </div>

      <Tarjeta className="overflow-hidden">
        <CabeceraTarjeta>Ganancia por producto</CabeceraTarjeta>
        <div className="overflow-x-auto">
          {!ganancia || ganancia.rows.length === 0 ? (
            <Vacio>Sin ventas en el período.</Vacio>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-borde text-xs uppercase tracking-wide text-apagado">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Producto</th>
                  <th className="w-24 px-2 py-2 text-right font-medium">Vendido</th>
                  <th className="w-28 px-2 py-2 text-right font-medium">Ingreso</th>
                  <th className="w-28 px-2 py-2 text-right font-medium">Costo</th>
                  <th className="w-28 px-2 py-2 text-right font-medium">Ganancia</th>
                  <th className="w-20 px-4 py-2 text-right font-medium">Margen</th>
                </tr>
              </thead>
              <tbody>
                {ganancia.rows.map((fila, indice) => {
                  const ingreso = toMoney(fila.revenue)
                  const gananciaFila = toMoney(fila.profit)
                  const margen = ingreso.amount > 0n ? Number((gananciaFila.amount * 1000n) / ingreso.amount) / 10 : 0
                  return (
                    <tr key={fila.productId ?? indice} className="border-b border-borde/60 last:border-0">
                      <td className="px-4 py-2">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-tinta">{fila.name}</span>
                          {!fila.hasCost ? <Insignia tono="alerta">sin costo</Insignia> : null}
                        </span>
                      </td>
                      <td className="cifra px-2 py-2 text-right text-apagado">{cantidad(BigInt(fila.quantity))}</td>
                      <td className="cifra px-2 py-2 text-right">{formatMoney(ingreso, { symbol: false })}</td>
                      <td className="cifra px-2 py-2 text-right text-apagado">
                        {formatMoney(toMoney(fila.cost), { symbol: false })}
                      </td>
                      <td className={`cifra px-2 py-2 text-right font-medium ${gananciaFila.amount < 0n ? 'text-error' : 'text-exito'}`}>
                        {formatMoney(gananciaFila, { symbol: false })}
                      </td>
                      <td className="cifra px-4 py-2 text-right text-apagado">{fila.hasCost ? `${margen.toFixed(0)}%` : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
        <p className="border-t border-borde px-4 py-2 text-xs text-apagado">
          Ganancia bruta en bolívares: ingreso a la tasa de cada venta menos el costo promedio de las compras. «Sin
          costo» marca productos vendidos sin ninguna compra cargada.
        </p>
      </Tarjeta>

      {retenciones.length > 0 ? (
        <Tarjeta className="overflow-hidden">
          <CabeceraTarjeta>Retenciones que le aplicaron</CabeceraTarjeta>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-borde text-xs uppercase tracking-wide text-apagado">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Fecha</th>
                  <th className="px-2 py-2 text-left font-medium">Cliente</th>
                  <th className="px-2 py-2 text-left font-medium">Documento</th>
                  <th className="w-16 px-2 py-2 text-center font-medium">Tipo</th>
                  <th className="px-2 py-2 text-left font-medium">Comprobante</th>
                  <th className="w-28 px-4 py-2 text-right font-medium">Retenido</th>
                </tr>
              </thead>
              <tbody>
                {retenciones.map((r, i) => (
                  <tr key={i} className="border-b border-borde/60 last:border-0">
                    <td className="cifra px-4 py-2 text-apagado">{new Date(r.occurredAt).toLocaleDateString('es-VE')}</td>
                    <td className="max-w-48 truncate px-2 py-2 text-tinta">{r.customerName}</td>
                    <td className="cifra px-2 py-2 text-apagado">{r.fullNumber}</td>
                    <td className="px-2 py-2 text-center">
                      <Insignia tono="acento">{r.kind === 'RETENTION_IVA' ? 'IVA' : 'ISLR'}</Insignia>
                    </td>
                    <td className="cifra px-2 py-2 text-apagado">{r.retentionNumber ?? '—'}</td>
                    <td className="cifra px-4 py-2 text-right font-medium text-tinta">{formatMoney(toMoney(r.amount))}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-borde text-sm font-medium">
                <tr>
                  <td className="px-4 py-2" colSpan={5}>
                    Total retenido
                  </td>
                  <td className="cifra px-4 py-2 text-right">
                    {formatMoney(money('VES', retenciones.reduce((acc, r) => acc + toMoney(r.amount).amount, 0n)))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Tarjeta>
      ) : null}

      <Tarjeta className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <CabeceraTarjeta>Libro de ventas</CabeceraTarjeta>
        <div className="min-h-0 flex-1 overflow-auto">
        {!libro || libro.rows.length === 0 ? (
          <Vacio>No hay documentos emitidos en el período.</Vacio>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 border-b border-borde bg-lienzo text-xs uppercase tracking-wide text-apagado">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Fecha</th>
                <th className="px-2 py-2 text-left font-medium">Documento</th>
                <th className="px-2 py-2 text-left font-medium">Cliente</th>
                <th className="px-2 py-2 text-right font-medium">Exento</th>
                <th className="px-2 py-2 text-right font-medium">Base 16%</th>
                <th className="px-2 py-2 text-right font-medium">IVA</th>
                <th className="px-2 py-2 text-right font-medium">IGTF</th>
                <th className="px-3 py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {libro.rows.map((fila) => (
                <tr
                  key={fila.fullNumber}
                  className={`border-b border-borde/60 last:border-0 ${fila.voided ? 'text-apagado' : ''}`}
                >
                  <td className="cifra px-3 py-1.5">{fila.date}</td>
                  <td className="cifra px-2 py-1.5">
                    <span className="inline-flex items-center gap-1.5">
                      {fila.fullNumber}
                      {fila.voided ? <Insignia tono="error">anulado</Insignia> : null}
                    </span>
                  </td>
                  <td className="max-w-48 truncate px-2 py-1.5">{fila.customerName}</td>
                  <td className="cifra px-2 py-1.5 text-right">{formatMoney(toMoney(fila.exempt), { symbol: false })}</td>
                  <td className="cifra px-2 py-1.5 text-right">
                    {formatMoney(toMoney(fila.baseGeneral), { symbol: false })}
                  </td>
                  <td className="cifra px-2 py-1.5 text-right">
                    {formatMoney(toMoney(fila.ivaGeneral), { symbol: false })}
                  </td>
                  <td className="cifra px-2 py-1.5 text-right">{formatMoney(toMoney(fila.igtf), { symbol: false })}</td>
                  <td className="cifra px-3 py-1.5 text-right font-medium">
                    {formatMoney(toMoney(fila.total), { symbol: false })}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="sticky bottom-0 border-t border-borde bg-white text-sm font-medium">
              <tr>
                <td className="px-3 py-2" colSpan={3}>
                  Totales del período
                </td>
                <td className="cifra px-2 py-2 text-right">
                  {formatMoney(toMoney(libro.totals.exempt), { symbol: false })}
                </td>
                <td className="cifra px-2 py-2 text-right">
                  {formatMoney(toMoney(libro.totals.baseGeneral), { symbol: false })}
                </td>
                <td className="cifra px-2 py-2 text-right">
                  {formatMoney(toMoney(libro.totals.ivaGeneral), { symbol: false })}
                </td>
                <td className="cifra px-2 py-2 text-right">
                  {formatMoney(toMoney(libro.totals.igtf), { symbol: false })}
                </td>
                <td className="cifra px-3 py-2 text-right">
                  {formatMoney(toMoney(libro.totals.total), { symbol: false })}
                </td>
              </tr>
            </tfoot>
          </table>
        )}
        </div>
      </Tarjeta>

      <p className="text-center text-xs text-apagado">
        Todos los importes en bolívares, como se lleva el libro. Los documentos anulados aparecen en cero para
        justificar el salto en la numeración.
      </p>
    </div>
  )
}

/**
 * Ventas por día, en barras.
 *
 * Una sola serie, así que un solo tono —el acento— y sin leyenda: el título ya
 * dice qué se mide. Las barras crecen desde la base y cada una lleva su importe
 * en el tooltip. Recesiva la línea de base, nada de rejilla ni ejes cargados.
 */
function GraficaVentas({ dias }: { dias: Dia[] }) {
  if (dias.length === 0) return null

  const maximo = dias.reduce((m, d) => {
    const v = toMoney(d.totalVes).amount
    return v > m ? v : m
  }, 1n)

  return (
    <Tarjeta className="p-4">
      <span className="block text-xs font-semibold uppercase tracking-wide text-apagado">Ventas por día</span>
      <div className="mt-3 flex h-40 items-end gap-0.5 border-b border-borde">
        {dias.map((d) => {
          const v = toMoney(d.totalVes).amount
          const pct = v > 0n ? Number((v * 1000n) / maximo) / 10 : 0
          return (
            <div
              key={d.date}
              className="group flex h-full flex-1 flex-col justify-end"
              title={`${d.date} · ${formatMoney(toMoney(d.totalVes))} · ${d.documents} doc.`}
            >
              <div
                className="rounded-t bg-acento transition group-hover:bg-acento-fuerte"
                style={{ height: `${Math.max(pct, v > 0n ? 2 : 0)}%` }}
              />
            </div>
          )
        })}
      </div>
      <div className="mt-1 flex gap-0.5 text-[10px] text-apagado">
        {dias.map((d) => (
          <span key={d.date} className="flex-1 truncate text-center">
            {d.date.slice(8)}
          </span>
        ))}
      </div>
    </Tarjeta>
  )
}

function Resumen({
  titulo,
  valor,
  detalle,
  tono,
}: {
  titulo: string
  valor: string
  detalle?: string | undefined
  tono?: 'exito' | undefined
}) {
  return (
    <Tarjeta className="px-4 py-3.5">
      <span className="block text-xs font-medium uppercase tracking-wide text-apagado">{titulo}</span>
      <span className={`cifra mt-1.5 block text-xl font-semibold ${tono === 'exito' ? 'text-exito' : 'text-tinta'}`}>
        {valor}
      </span>
      {detalle ? (
        <span className="mt-1 inline-block">
          <Insignia tono={tono ?? 'neutro'}>{detalle}</Insignia>
        </span>
      ) : null}
    </Tarjeta>
  )
}
