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

import {
  ApiError,
  api,
  fromMoney,
  toMoney,
  type BorradorVenta,
  type CustomerJson,
  type DocumentKind,
  type FullDocumentJson,
  type PriceListJson,
  type ProductJson,
  type SaleResponse,
} from '../api'
import { buscarLocal, encolarVenta, tomarNumero } from '../local'
import { aMilesimas, aMonto, cantidad } from '../formato'
import { Aviso, Boton, Campo, Insignia, Segmentado, Select, Tarjeta, Vacio } from '../components/ui'
import { VisorDocumento } from '../components/DocumentoImprimible'

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
  borrador,
  onBorradorUsado,
}: {
  rate: Rate
  stationId: string
  tenantId: string
  enLinea: boolean
  onVendido: () => void
  borrador?: BorradorVenta | null | undefined
  onBorradorUsado?: (() => void) | undefined
}) {
  const [busqueda, setBusqueda] = useState('')
  const [resultados, setResultados] = useState<ProductJson[]>([])
  const [resaltado, setResaltado] = useState(0)
  const [carrito, setCarrito] = useState<LineaCarrito[]>([])
  const [pagos, setPagos] = useState<PagoCapturado[]>([])
  const [error, setError] = useState<string | null>(null)
  const [emitida, setEmitida] = useState<SaleResponse | null>(null)
  const [cobrando, setCobrando] = useState(false)
  const [kind, setKind] = useState<DocumentKind>('NOTA_ENTREGA')
  const [cliente, setCliente] = useState<CustomerJson | null>(null)
  const [imprimible, setImprimible] = useState<FullDocumentJson | null>(null)
  const [listas, setListas] = useState<PriceListJson[]>([])
  const [listaId, setListaId] = useState('') // vacío = lista predeterminada (detal)
  const buscador = useRef<HTMLInputElement>(null)

  // Listas de precios (detal/mayor). Solo se aplican en línea.
  useEffect(() => {
    if (!enLinea) return
    void api
      .get<{ priceLists: PriceListJson[] }>('/price-lists')
      .then((d) => setListas(d.priceLists))
      .catch(() => undefined)
  }, [enLinea])

  // Sin conexión solo se emite nota de entrega: la factura necesita su número de
  // control, que se asigna en el servidor, y el presupuesto no se cobra en caja.
  useEffect(() => {
    if (!enLinea && kind !== 'NOTA_ENTREGA') setKind('NOTA_ENTREGA')
  }, [enLinea, kind])

  // Convertir un presupuesto: precarga el carrito con sus productos a precio de
  // hoy y su cliente, listo para cobrar como factura.
  useEffect(() => {
    if (!borrador) return
    const ids = borrador.lines.map((l) => l.productId)
    if (ids.length === 0) {
      onBorradorUsado?.()
      return
    }
    void api
      .get<{ products: ProductJson[] }>(`/products/by-ids?ids=${ids.join(',')}`)
      .then((d) => {
        const porId = new Map(d.products.map((p) => [p.productId, p]))
        const nuevas = borrador.lines
          .map((l, i): LineaCarrito | null => {
            const producto = porId.get(l.productId)
            return producto ? { clave: `${producto.productId}-${i}`, producto, cantidad: BigInt(l.quantity) } : null
          })
          .filter((x): x is LineaCarrito => x !== null)
        setCarrito(nuevas)
        setEmitida(null)
        setKind('FACTURA')
        if (borrador.customer) {
          setCliente({
            customerId: borrador.customer.customerId,
            id: borrador.customer.id,
            name: borrador.customer.name,
            phone: null,
            specialTaxpayer: false,
            openReceivables: 0,
          })
        }
      })
      .catch(() => setError('No se pudieron cargar los productos del presupuesto.'))
      .finally(() => onBorradorUsado?.())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [borrador])

  // Búsqueda con retardo. Un lector de código de barras teclea muy rápido y
  // termina en Enter, así que también cae aquí sin tratamiento especial.
  useEffect(() => {
    const termino = busqueda.trim()
    if (termino === '') {
      setResultados([])
      return
    }

    const temporizador = setTimeout(() => {
      const lista = listaId ? `&priceListId=${listaId}` : ''
      const buscar = enLinea
        ? api
            .get<{ products: ProductJson[] }>(`/products?q=${encodeURIComponent(termino)}&limit=8${lista}`)
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
  }, [busqueda, enLinea, tenantId, listaId])

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
  // Un presupuesto es una cotización: se emite sin cobrar.
  const esPresupuesto = kind === 'PRESUPUESTO'

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
          kind,
          ...(cliente ? { customerId: cliente.customerId } : {}),
          ...(listaId ? { priceListId: listaId } : {}),
          lines: lineas,
          payments: esPresupuesto ? [] : pagosCuerpo,
        })
        setEmitida(venta)
        setCliente(null)
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

  /** Trae el documento emitido y lo abre para imprimir. */
  async function imprimir(documentId: string) {
    try {
      const full = await api.get<{ document: FullDocumentJson }>(`/documents/${documentId}`)
      setImprimible(full.document)
    } catch (fallo) {
      setError(fallo instanceof ApiError ? fallo.message : 'No se pudo abrir el documento para imprimir.')
    }
  }

  return (
    <div className="grid h-full grid-cols-1 gap-4 lg:grid-cols-[1fr_420px]">
      {/* --- Izquierda: búsqueda y carrito --- */}
      <div className="flex min-h-0 flex-col gap-4">
        <Tarjeta className="relative p-2">
          <div className="relative">
            <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-apagado">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="7" />
                <path d="m21 21-4.3-4.3" />
              </svg>
            </span>
            <input
              ref={buscador}
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              onKeyDown={teclaEnBuscador}
              placeholder="Escanee o escriba nombre, código o código de barras…"
              autoFocus
              className="w-full rounded-lg border border-borde bg-lienzo py-3 pl-11 pr-4 text-base outline-none transition focus:border-acento focus:ring-2 focus:ring-acento/20"
            />
          </div>

          {resultados.length > 0 ? (
            <ul className="surgir absolute inset-x-2 top-full z-20 mt-1 max-h-80 overflow-auto rounded-xl border border-borde bg-lienzo p-1 shadow-flotante">
              {resultados.map((producto, indice) => (
                <li key={producto.productId}>
                  <button
                    onMouseEnter={() => setResaltado(indice)}
                    onClick={() => agregar(producto)}
                    className={`flex w-full items-center justify-between gap-4 rounded-lg px-3 py-2 text-left transition ${
                      indice === resaltado ? 'bg-acento-tenue' : 'hover:bg-tenue'
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-tinta">{producto.name}</span>
                      <span className="cifra block text-xs text-apagado">
                        {producto.sku}
                        {producto.tracksStock ? ` · existencia ${cantidad(BigInt(producto.stock))}` : ''}
                      </span>
                    </span>
                    <span className="cifra shrink-0 text-right text-sm">
                      <span className="block font-medium text-tinta">
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
                <thead className="sticky top-0 z-10 border-b border-borde bg-lienzo text-xs uppercase tracking-wide text-apagado">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-medium">Producto</th>
                    <th className="w-28 px-2 py-2.5 text-right font-medium">Cantidad</th>
                    <th className="w-40 px-4 py-2.5 text-right font-medium">Importe</th>
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
                        <td className="px-4 py-2.5">
                          <span className="block font-medium text-tinta">{linea.producto.name}</span>
                          <span className="cifra block text-xs text-apagado">
                            {formatMoney(convert(precioUsd, 'VES', rate))} c/u
                          </span>
                        </td>
                        <td className="px-2 py-2.5">
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
                            className="cifra h-9 w-full rounded-lg border border-borde bg-lienzo px-2 text-right outline-none transition focus:border-acento focus:ring-2 focus:ring-acento/20"
                          />
                        </td>
                        <td className="cifra px-4 py-2.5 text-right">
                          <span className="block font-medium text-tinta">{formatMoney(convert(importe, 'VES', rate))}</span>
                          <span className="block text-xs text-apagado">{formatMoney(importe)}</span>
                        </td>
                        <td className="px-2 py-2.5 text-right">
                          <button
                            onClick={() =>
                              setCarrito((actual) => actual.filter((otra) => otra.clave !== linea.clave))
                            }
                            className="rounded-lg p-1.5 text-apagado transition hover:bg-error-tenue hover:text-error"
                            aria-label="Quitar"
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                              <path d="M18 6 6 18M6 6l12 12" />
                            </svg>
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

      {/* --- Derecha: documento, totales y cobro --- */}
      <div className="flex min-h-0 flex-col gap-4">
        <SelectorDocumento
          kind={kind}
          onKind={setKind}
          cliente={cliente}
          onCliente={setCliente}
          enLinea={enLinea}
          listas={listas}
          listaId={listaId}
          onListaId={setListaId}
        />

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

        {esPresupuesto ? (
          <Tarjeta className="p-4 text-sm text-apagado">
            Un presupuesto es una cotización: se emite sin cobrar y no descuenta inventario. Agregue los
            productos y emítalo.
          </Tarjeta>
        ) : (
          <PanelPagos
            rate={rate}
            totales={totales.total}
            pagos={pagos}
            setPagos={setPagos}
            restante={restante}
            cambio={liquidacion?.change ?? zero('USD')}
          />
        )}

        {error ? <Aviso>{error}</Aviso> : null}

        {emitida ? (
          <div className="space-y-2">
            <Aviso tipo="exito">
              {enLinea ? 'Emitida' : 'Guardada para subir'} {emitida.fullNumber}
              {BigInt(emitida.settlement.change.amount) > 0n
                ? ` · vuelto ${formatMoney(toMoney(emitida.settlement.change))}`
                : ''}
            </Aviso>
            {emitida.documentId ? (
              <Boton variante="normal" className="w-full" onClick={() => void imprimir(emitida.documentId)}>
                Imprimir documento
              </Boton>
            ) : null}
          </div>
        ) : null}

        <Boton
          variante="principal"
          tamano="xl"
          className="w-full text-base font-semibold"
          disabled={carrito.length === 0 || cobrando || (!esPresupuesto && restante.amount !== 0n)}
          onClick={() => void cobrar()}
        >
          {cobrando
            ? enLinea
              ? 'Emitiendo…'
              : 'Guardando…'
            : carrito.length === 0
              ? 'Sin productos'
              : esPresupuesto
                ? 'Emitir presupuesto'
                : restante.amount !== 0n
                  ? `Falta ${formatMoney(convert(restante, 'VES', rate))}`
                  : 'Cobrar'}
        </Boton>
      </div>

      {imprimible ? <VisorDocumento documento={imprimible} onCerrar={() => setImprimible(null)} /> : null}
    </div>
  )
}

const TIPOS_DOC: { valor: DocumentKind; nombre: string }[] = [
  { valor: 'NOTA_ENTREGA', nombre: 'Nota de entrega' },
  { valor: 'FACTURA', nombre: 'Factura' },
  { valor: 'PRESUPUESTO', nombre: 'Presupuesto' },
]

/**
 * Elige el tipo de documento y el cliente antes de cobrar.
 *
 * Sin conexión el tipo queda fijo en nota de entrega. La factura pide cliente
 * —una factura a «consumidor final» se permite, pero se avisa— porque el nombre
 * y el RIF del cliente son la mitad de una factura.
 */
function SelectorDocumento({
  kind,
  onKind,
  cliente,
  onCliente,
  enLinea,
  listas,
  listaId,
  onListaId,
}: {
  kind: DocumentKind
  onKind: (valor: DocumentKind) => void
  cliente: CustomerJson | null
  onCliente: (cliente: CustomerJson | null) => void
  enLinea: boolean
  listas: PriceListJson[]
  listaId: string
  onListaId: (id: string) => void
}) {
  const [busqueda, setBusqueda] = useState('')
  const [resultados, setResultados] = useState<CustomerJson[]>([])
  const [abierto, setAbierto] = useState(false)

  useEffect(() => {
    if (!abierto) return
    const termino = busqueda.trim()
    const t = setTimeout(() => {
      void api
        .get<{ customers: CustomerJson[] }>(`/customers?q=${encodeURIComponent(termino)}&limit=8`)
        .then((d) => setResultados(d.customers))
        .catch(() => setResultados([]))
    }, 150)
    return () => clearTimeout(t)
  }, [busqueda, abierto])

  return (
    <Tarjeta className="space-y-3 p-3">
      <Segmentado
        valor={kind}
        onCambio={onKind}
        opciones={enLinea ? TIPOS_DOC : [{ valor: 'NOTA_ENTREGA', nombre: 'Nota de entrega' }]}
        className="w-full"
      />

      {enLinea && listas.length > 1 ? (
        <Select
          etiqueta="Lista de precios"
          value={listaId}
          onChange={(e) => onListaId(e.target.value)}
        >
          {listas.map((l) => (
            <option key={l.id} value={l.isDefault ? '' : l.id}>
              {l.name}
            </option>
          ))}
        </Select>
      ) : null}

      <div className="relative">
        {cliente ? (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-borde bg-tenue px-3 py-2">
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-tinta">{cliente.name}</span>
              <span className="cifra block text-xs text-apagado">{cliente.id}</span>
            </span>
            <button
              onClick={() => onCliente(null)}
              aria-label="Quitar cliente"
              className="shrink-0 rounded-md p-1 text-apagado transition hover:bg-error-tenue hover:text-error"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        ) : (
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            onFocus={() => setAbierto(true)}
            onBlur={() => setTimeout(() => setAbierto(false), 150)}
            placeholder={kind === 'FACTURA' ? 'Cliente (nombre o RIF)…' : 'Cliente (opcional)…'}
            className="h-10 w-full rounded-lg border border-borde bg-lienzo px-3 text-sm outline-none transition focus:border-acento focus:ring-2 focus:ring-acento/20"
          />
        )}

        {abierto && !cliente && resultados.length > 0 ? (
          <ul className="surgir absolute inset-x-0 top-full z-20 mt-1 max-h-60 overflow-auto rounded-xl border border-borde bg-lienzo p-1 shadow-flotante">
            {resultados.map((c) => (
              <li key={c.customerId}>
                <button
                  onMouseDown={() => {
                    onCliente(c)
                    setBusqueda('')
                    setResultados([])
                  }}
                  className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left transition hover:bg-tenue"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-tinta">{c.name}</span>
                    <span className="cifra block text-xs text-apagado">{c.id}</span>
                  </span>
                  {c.specialTaxpayer ? <Insignia tono="acento">especial</Insignia> : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {kind === 'FACTURA' && !cliente ? (
        <p className="text-xs text-alerta">
          Sin cliente, la factura sale a «consumidor final».
        </p>
      ) : null}
    </Tarjeta>
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
      <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-apagado">Medio de pago</span>
      <div className="flex flex-wrap gap-1.5">
        {MEDIOS.map((item) => (
          <button
            key={item.method}
            onClick={() => setMedio(item.method)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
              medio === item.method
                ? 'border-acento bg-acento-tenue text-acento'
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

      <ul className="mt-3 min-h-0 flex-1 space-y-1.5 overflow-auto">
        {pagos.map((pago) => (
          <li
            key={pago.clave}
            className="flex items-center justify-between gap-2 rounded-lg bg-tenue px-3 py-2 text-sm"
          >
            <span className="min-w-0 truncate text-tinta">
              {MEDIOS.find((item) => item.method === pago.method)?.nombre}
              {pago.referencia ? <span className="text-apagado"> · {pago.referencia}</span> : null}
            </span>
            <span className="flex shrink-0 items-center gap-2">
              <span className="cifra font-medium text-tinta">{formatMoney(pago.monto)}</span>
              <button
                onClick={() => setPagos((actual) => actual.filter((otro) => otro.clave !== pago.clave))}
                aria-label="Quitar pago"
                className="rounded-md p-1 text-apagado transition hover:bg-error-tenue hover:text-error"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
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
