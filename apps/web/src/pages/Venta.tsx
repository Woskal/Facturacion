import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ALICUOTAS,
  add,
  computeLine,
  computeTotals,
  convert,
  formatMoney,
  grossUpIgtf,
  money,
  settle,
  subtract,
  zero,
  type Currency,
  type Money,
  type PaymentMethod,
  type Rate,
} from '@fve/money'

import { ApiError, api, fromMoney, toMoney, type ProductJson, type SaleResponse } from '../api'
import { buscarLocal, encolarVenta, tomarNumero } from '../local'
import { aMilesimas, aMonto, cantidad } from '../formato'
import { Aviso, Boton, Campo, Tarjeta, Vacio } from '../components/ui'

interface LineaCarrito {
  readonly clave: string
  readonly producto: ProductJson
  readonly cantidad: bigint
}

interface PagoCapturado {
  readonly clave: string
  readonly method: PaymentMethod
  readonly monto: Money
  readonly referencia: string
}

const MEDIOS: { method: PaymentMethod; nombre: string; moneda: Currency; referencia: boolean }[] = [
  { method: 'EFECTIVO_BS', nombre: 'Efectivo Bs', moneda: 'VES', referencia: false },
  { method: 'PAGO_MOVIL', nombre: 'Pago móvil', moneda: 'VES', referencia: true },
  { method: 'PUNTO_VENTA', nombre: 'Punto de venta', moneda: 'VES', referencia: true },
  { method: 'TRANSFERENCIA_BS', nombre: 'Transferencia', moneda: 'VES', referencia: true },
  { method: 'EFECTIVO_USD', nombre: 'Efectivo divisa', moneda: 'USD', referencia: false },
  { method: 'ZELLE', nombre: 'Zelle', moneda: 'USD', referencia: true },
  { method: 'USDT', nombre: 'USDT', moneda: 'USD', referencia: true },
]

/**
 * Punto de venta.
 *
 * El total se calcula en el navegador con el MISMO paquete que usa el servidor,
 * así que lo que ve el cliente en pantalla y lo que queda en el documento no
 * pueden discrepar. El servidor vuelve a calcularlo igual y es quien manda: esto
 * es para que el cajero vea el número al instante, no para reemplazarlo.
 */
export function Venta({
  rate,
  stationId,
  tenantId,
  enLinea,
  onVendido,
}: {
  rate: Rate
  stationId: string
  tenantId: string
  enLinea: boolean
  onVendido: () => void
}) {
  const [busqueda, setBusqueda] = useState('')
  const [resultados, setResultados] = useState<ProductJson[]>([])
  const [resaltado, setResaltado] = useState(0)
  const [carrito, setCarrito] = useState<LineaCarrito[]>([])
  const [pagos, setPagos] = useState<PagoCapturado[]>([])
  const [error, setError] = useState<string | null>(null)
  const [emitida, setEmitida] = useState<SaleResponse | null>(null)
  const [cobrando, setCobrando] = useState(false)
  const buscador = useRef<HTMLInputElement>(null)

  // Búsqueda con retardo. Un lector de código de barras teclea muy rápido y
  // termina en Enter, así que también cae aquí sin tratamiento especial.
  useEffect(() => {
    const termino = busqueda.trim()
    if (termino === '') {
      setResultados([])
      return
    }

    const temporizador = setTimeout(() => {
      const buscar = enLinea
        ? api
            .get<{ products: ProductJson[] }>(`/products?q=${encodeURIComponent(termino)}&limit=8`)
            .then((data) => data.products)
            // Si la red falla en mitad de la búsqueda, se cae al catálogo
            // guardado en vez de dejar al cajero sin resultados.
            .catch(() => buscarLocal(tenantId, termino))
        : buscarLocal(tenantId, termino)

      void buscar
        .then((productos) => {
          setResultados(productos)
          setResaltado(0)
        })
        .catch(() => setResultados([]))
    }, 120)

    return () => clearTimeout(temporizador)
  }, [busqueda, enLinea, tenantId])

  function agregar(producto: ProductJson) {
    setEmitida(null)
    setCarrito((actual) => {
      const existente = actual.find((linea) => linea.producto.productId === producto.productId)
      if (existente) {
        return actual.map((linea) =>
          linea.clave === existente.clave ? { ...linea, cantidad: linea.cantidad + 1000n } : linea,
        )
      }
      return [
        ...actual,
        { clave: `${producto.productId}-${actual.length}`, producto, cantidad: 1000n },
      ]
    })
    setBusqueda('')
    setResultados([])
    buscador.current?.focus()
  }

  function teclaEnBuscador(evento: React.KeyboardEvent<HTMLInputElement>) {
    if (evento.key === 'ArrowDown') {
      evento.preventDefault()
      setResaltado((valor) => Math.min(valor + 1, resultados.length - 1))
    } else if (evento.key === 'ArrowUp') {
      evento.preventDefault()
      setResaltado((valor) => Math.max(valor - 1, 0))
    } else if (evento.key === 'Enter') {
      evento.preventDefault()
      const termino = busqueda.trim().toLowerCase()
      // Un lector deja el código exacto: se agrega directo sin mirar la lista.
      const exacto = resultados.find(
        (p) => p.barcode?.toLowerCase() === termino || p.sku.toLowerCase() === termino,
      )
      const elegido = exacto ?? resultados[resaltado]
      if (elegido) agregar(elegido)
    } else if (evento.key === 'Escape') {
      setBusqueda('')
      setResultados([])
    }
  }

  // --- Cálculo en vivo ------------------------------------------------------

  const totales = useMemo(() => {
    const lineas = carrito.map((linea) =>
      computeLine({
        quantity: linea.cantidad,
        unitPrice: convert(toMoney(linea.producto.price), 'USD', rate),
        alicuota:
          linea.producto.taxCode === 'E'
            ? ALICUOTAS.EXENTO
            : linea.producto.taxCode === 'R'
              ? ALICUOTAS.REDUCIDA
              : linea.producto.taxCode === 'S'
                ? ALICUOTAS.SUNTUARIA
                : ALICUOTAS.GENERAL,
        priceMode: linea.producto.priceMode,
      }),
    )
    return computeTotals(lineas, 'USD')
  }, [carrito, rate])

  const liquidacion = useMemo(() => {
    try {
      return settle({
        total: totales.total,
        payments: pagos.map((pago) => ({
          method: pago.method,
          amount: pago.monto,
          ...(pago.referencia ? { reference: pago.referencia } : {}),
        })),
        rate,
      })
    } catch {
      return null
    }
  }, [totales, pagos, rate])

  const totalBs = convert(totales.total, 'VES', rate)
  const restante = liquidacion ? liquidacion.balance : totales.total

  /**
   * Cobra la venta.
   *
   * Con internet va directo al servidor. Sin internet toma un número del bloque
   * apartado, deja la venta en la cola y sigue: la caja no se detiene porque se
   * haya caído la red, que es todo el punto.
   */
  async function cobrar() {
    setError(null)
    setCobrando(true)

    const lineas = carrito.map((linea) => ({
      productId: linea.producto.productId,
      quantity: linea.cantidad.toString(),
    }))
    const pagosCuerpo = pagos.map((pago) => ({
      method: pago.method,
      amount: fromMoney(pago.monto),
      ...(pago.referencia ? { reference: pago.referencia } : {}),
    }))

    try {
      if (enLinea) {
        const venta = await api.post<SaleResponse>('/sales', {
          stationId,
          currency: 'USD',
          lines: lineas,
          payments: pagosCuerpo,
        })
        setEmitida(venta)
      } else {
        const asignado = await tomarNumero(tenantId)
        if (!asignado) {
          setError(
            'Se acabaron los números apartados para esta caja. Conéctese para pedir más antes de seguir vendiendo.',
          )
          return
        }

        const occurredAt = new Date().toISOString()
        const clientRef = `${stationId}:${asignado.numero}`

        await encolarVenta({
          tenantId,
          stationId,
          clientRef,
          reservedNumber: asignado.numero,
          fullNumber: asignado.fullNumber,
          occurredAt,
          totalVes: fromMoney(convert(liquidacion?.totalDue ?? totales.total, 'VES', rate)),
          cuerpo: {
            stationId,
            currency: 'USD',
            lines: lineas,
            payments: pagosCuerpo,
            reservedNumber: asignado.numero,
            clientRef,
            occurredAt,
          },
        })

        setEmitida({
          fullNumber: asignado.fullNumber,
          settlement: {
            change: fromMoney(liquidacion?.change ?? zero('USD')),
          },
        } as SaleResponse)
      }

      setCarrito([])
      setPagos([])
      onVendido()
      buscador.current?.focus()
    } catch (fallo) {
      setError(fallo instanceof ApiError ? fallo.message : 'No se pudo emitir la venta.')
    } finally {
      setCobrando(false)
    }
  }

  return (
    <div className="grid h-full grid-cols-1 gap-4 lg:grid-cols-[1fr_420px]">
      {/* --- Izquierda: búsqueda y carrito --- */}
      <div className="flex min-h-0 flex-col gap-4">
        <Tarjeta className="relative p-3">
          <input
            ref={buscador}
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            onKeyDown={teclaEnBuscador}
            placeholder="Escanee o escriba nombre, código o código de barras…"
            autoFocus
            className="w-full rounded-lg border border-borde bg-white px-4 py-3 text-base outline-none focus:border-acento focus:ring-2 focus:ring-acento/20"
          />

          {resultados.length > 0 ? (
            <ul className="absolute inset-x-3 top-full z-20 mt-1 max-h-80 overflow-auto rounded-lg border border-borde bg-white shadow-lg">
              {resultados.map((producto, indice) => (
                <li key={producto.productId}>
                  <button
                    onMouseEnter={() => setResaltado(indice)}
                    onClick={() => agregar(producto)}
                    className={`flex w-full items-center justify-between gap-4 px-4 py-2 text-left ${
                      indice === resaltado ? 'bg-acento/10' : ''
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{producto.name}</span>
                      <span className="block text-xs text-apagado">
                        {producto.sku}
                        {producto.tracksStock ? ` · existencia ${cantidad(BigInt(producto.stock))}` : ''}
                      </span>
                    </span>
                    <span className="cifra shrink-0 text-right text-sm">
                      <span className="block font-medium">
                        {formatMoney(convert(toMoney(producto.price), 'VES', rate))}
                      </span>
                      <span className="block text-xs text-apagado">{formatMoney(toMoney(producto.price))}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </Tarjeta>

        <Tarjeta className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {carrito.length === 0 ? (
            <Vacio>Escanee un producto o escriba su nombre para comenzar.</Vacio>
          ) : (
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 border-b border-borde bg-white text-xs text-apagado">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Producto</th>
                    <th className="w-28 px-2 py-2 text-right font-medium">Cantidad</th>
                    <th className="w-40 px-4 py-2 text-right font-medium">Importe</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {carrito.map((linea) => {
                    const precioUsd = convert(toMoney(linea.producto.price), 'USD', rate)
                    const importe = money(
                      'USD',
                      (precioUsd.amount * linea.cantidad + 500n) / 1000n,
                    )
                    return (
                      <tr key={linea.clave} className="border-b border-borde/60 last:border-0">
                        <td className="px-4 py-2">
                          <span className="block font-medium">{linea.producto.name}</span>
                          <span className="cifra block text-xs text-apagado">
                            {formatMoney(convert(precioUsd, 'VES', rate))} c/u
                          </span>
                        </td>
                        <td className="px-2 py-2">
                          <input
                            value={cantidad(linea.cantidad)}
                            onChange={(e) => {
                              const valor = aMilesimas(e.target.value)
                              if (valor === null) return
                              setCarrito((actual) =>
                                actual.map((otra) =>
                                  otra.clave === linea.clave ? { ...otra, cantidad: valor } : otra,
                                ),
                              )
                            }}
                            className="cifra w-full rounded border border-borde px-2 py-1 text-right outline-none focus:border-acento"
                          />
                        </td>
                        <td className="cifra px-4 py-2 text-right">
                          <span className="block font-medium">{formatMoney(convert(importe, 'VES', rate))}</span>
                          <span className="block text-xs text-apagado">{formatMoney(importe)}</span>
                        </td>
                        <td className="px-2 py-2 text-right">
                          <button
                            onClick={() =>
                              setCarrito((actual) => actual.filter((otra) => otra.clave !== linea.clave))
                            }
                            className="rounded px-2 py-1 text-apagado hover:bg-error/10 hover:text-error"
                            title="Quitar"
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Tarjeta>
      </div>

      {/* --- Derecha: totales y cobro --- */}
      <div className="flex min-h-0 flex-col gap-4">
        <Tarjeta className="p-4">
          <div className="flex items-baseline justify-between text-sm text-apagado">
            <span>Base imponible</span>
            <span className="cifra">{formatMoney(convert(totales.base, 'VES', rate))}</span>
          </div>
          {totales.exempt.amount > 0n ? (
            <div className="mt-1 flex items-baseline justify-between text-sm text-apagado">
              <span>Exento</span>
              <span className="cifra">{formatMoney(convert(totales.exempt, 'VES', rate))}</span>
            </div>
          ) : null}
          <div className="mt-1 flex items-baseline justify-between text-sm text-apagado">
            <span>IVA</span>
            <span className="cifra">{formatMoney(convert(totales.ivaTotal, 'VES', rate))}</span>
          </div>
          {liquidacion && liquidacion.igtf.amount > 0n ? (
            <div className="mt-1 flex items-baseline justify-between text-sm text-alerta">
              <span>IGTF sobre divisa</span>
              <span className="cifra">{formatMoney(convert(liquidacion.igtf, 'VES', rate))}</span>
            </div>
          ) : null}

          <div className="mt-3 border-t border-borde pt-3">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-medium">Total</span>
              <span className="cifra text-3xl font-semibold">
                {formatMoney(liquidacion ? convert(liquidacion.totalDue, 'VES', rate) : totalBs)}
              </span>
            </div>
            <div className="mt-1 flex items-baseline justify-between text-sm text-apagado">
              <span>equivale a</span>
              <span className="cifra">
                {formatMoney(liquidacion ? liquidacion.totalDue : totales.total)}
              </span>
            </div>
          </div>
        </Tarjeta>

        <PanelPagos
          rate={rate}
          totales={totales.total}
          pagos={pagos}
          setPagos={setPagos}
          restante={restante}
          cambio={liquidacion?.change ?? zero('USD')}
        />

        {error ? <Aviso>{error}</Aviso> : null}

        {emitida ? (
          <Aviso tipo="exito">
            {enLinea ? 'Emitida' : 'Guardada para subir'} {emitida.fullNumber}
            {BigInt(emitida.settlement.change.amount) > 0n
              ? ` · vuelto ${formatMoney(toMoney(emitida.settlement.change))}`
              : ''}
          </Aviso>
        ) : null}

        <Boton
          variante="principal"
          className="py-4 text-base"
          disabled={carrito.length === 0 || restante.amount !== 0n || cobrando}
          onClick={() => void cobrar()}
        >
          {cobrando
            ? enLinea
              ? 'Emitiendo…'
              : 'Guardando…'
            : carrito.length === 0
              ? 'Sin productos'
              : restante.amount !== 0n
                ? `Falta ${formatMoney(convert(restante, 'VES', rate))}`
                : 'Cobrar'}
        </Boton>
      </div>
    </div>
  )
}

/**
 * Captura de pagos.
 *
 * Ofrece el botón «lo justo» por medio: en divisa calcula el total con su propio
 * IGTF, porque cobrar el total pelado dejaría la caja corta todos los días.
 */
function PanelPagos({
  rate,
  totales,
  pagos,
  setPagos,
  restante,
  cambio,
}: {
  rate: Rate
  totales: Money
  pagos: PagoCapturado[]
  setPagos: (actualizar: (actual: PagoCapturado[]) => PagoCapturado[]) => void
  restante: Money
  cambio: Money
}) {
  const [medio, setMedio] = useState<PaymentMethod>('EFECTIVO_BS')
  const [texto, setTexto] = useState('')
  const [referencia, setReferencia] = useState('')

  const spec = MEDIOS.find((item) => item.method === medio) ?? MEDIOS[0]!
  const monto = aMonto(texto, spec.moneda)

  function sugerido(): Money {
    const faltante = restante.amount > 0n ? restante : zero('USD')
    if (spec.moneda === 'USD') {
      // En divisa hay que cobrar el remanente MÁS su propio IGTF.
      return grossUpIgtf(faltante)
    }
    return convert(faltante, 'VES', rate)
  }

  function agregarPago(valor: Money) {
    if (valor.amount <= 0n) return
    if (spec.referencia && referencia.trim() === '') return

    setPagos((actual) => [
      ...actual,
      {
        clave: `${medio}-${actual.length}-${valor.amount}`,
        method: medio,
        monto: valor,
        referencia: referencia.trim(),
      },
    ])
    setTexto('')
    setReferencia('')
  }

  const recibido = pagos.reduce<Money>(
    (acumulado, pago) => add(acumulado, convert(pago.monto, 'USD', rate)),
    zero('USD'),
  )

  return (
    <Tarjeta className="flex min-h-0 flex-1 flex-col p-4">
      <div className="flex flex-wrap gap-1">
        {MEDIOS.map((item) => (
          <button
            key={item.method}
            onClick={() => setMedio(item.method)}
            className={`rounded-md border px-2.5 py-1 text-xs transition ${
              medio === item.method
                ? 'border-acento bg-acento/10 font-medium text-acento'
                : 'border-borde text-apagado hover:text-tinta'
            }`}
          >
            {item.nombre}
          </button>
        ))}
      </div>

      <div className="mt-3 flex gap-2">
        <Campo
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && monto) agregarPago(monto)
          }}
          placeholder={spec.moneda === 'VES' ? 'Monto en Bs' : 'Monto en $'}
          className="cifra text-right"
        />
        <Boton onClick={() => agregarPago(sugerido())} title="Cobrar lo que falta con este medio">
          Lo justo
        </Boton>
      </div>

      {spec.referencia ? (
        <div className="mt-2">
          <Campo
            value={referencia}
            onChange={(e) => setReferencia(e.target.value)}
            placeholder="Referencia (obligatoria)"
            ayuda="Sin referencia no se puede conciliar con el banco después."
          />
        </div>
      ) : null}

      <Boton
        className="mt-2"
        disabled={!monto || monto.amount <= 0n || (spec.referencia && referencia.trim() === '')}
        onClick={() => monto && agregarPago(monto)}
      >
        Agregar pago
      </Boton>

      <ul className="mt-3 min-h-0 flex-1 space-y-1 overflow-auto">
        {pagos.map((pago) => (
          <li
            key={pago.clave}
            className="flex items-center justify-between rounded-md bg-papel px-3 py-1.5 text-sm"
          >
            <span>
              {MEDIOS.find((item) => item.method === pago.method)?.nombre}
              {pago.referencia ? <span className="text-apagado"> · {pago.referencia}</span> : null}
            </span>
            <span className="flex items-center gap-2">
              <span className="cifra">{formatMoney(pago.monto)}</span>
              <button
                onClick={() => setPagos((actual) => actual.filter((otro) => otro.clave !== pago.clave))}
                className="text-apagado hover:text-error"
              >
                ×
              </button>
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-3 space-y-1 border-t border-borde pt-3 text-sm">
        <div className="flex justify-between text-apagado">
          <span>Recibido</span>
          <span className="cifra">{formatMoney(convert(recibido, 'VES', rate))}</span>
        </div>
        {cambio.amount > 0n ? (
          <div className="flex justify-between font-medium text-exito">
            <span>Vuelto</span>
            <span className="cifra">{formatMoney(cambio)}</span>
          </div>
        ) : (
          <div className="flex justify-between font-medium">
            <span>Falta</span>
            <span className="cifra">
              {formatMoney(convert(restante.amount > 0n ? restante : subtract(totales, totales), 'VES', rate))}
            </span>
          </div>
        )}
      </div>
    </Tarjeta>
  )
}
