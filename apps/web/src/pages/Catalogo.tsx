import { useCallback, useEffect, useState } from 'react'
import { convert, formatMoney, type Rate } from '@fve/money'

import { ApiError, api, fromMoney, toMoney, type PriceListJson, type ProductJson, type TaxRateJson } from '../api'
import { aMilesimas, aMonto, cantidad } from '../formato'
import {
  Aviso,
  Boton,
  Campo,
  Encabezado,
  Insignia,
  Modal,
  Segmentado,
  Select,
  Tarjeta,
  Vacio,
} from '../components/ui'

export function Catalogo({ rate }: { rate: Rate }) {
  const [productos, setProductos] = useState<ProductJson[]>([])
  const [alicuotas, setAlicuotas] = useState<TaxRateJson[]>([])
  const [listas, setListas] = useState<PriceListJson[]>([])
  const [busqueda, setBusqueda] = useState('')
  const [soloBajos, setSoloBajos] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [creando, setCreando] = useState(false)
  const [ajustando, setAjustando] = useState<ProductJson | null>(null)
  const [editando, setEditando] = useState<ProductJson | null>(null)

  const cargar = useCallback(async () => {
    try {
      const ruta = soloBajos
        ? '/products/low-stock'
        : `/products?q=${encodeURIComponent(busqueda.trim())}&limit=200`
      const data = await api.get<{ products: ProductJson[] }>(ruta)
      setProductos(data.products)
      setError(null)
    } catch (fallo) {
      setError(fallo instanceof ApiError ? fallo.message : 'No se pudo cargar el catálogo.')
    }
  }, [busqueda, soloBajos])

  useEffect(() => {
    const temporizador = setTimeout(() => void cargar(), 150)
    return () => clearTimeout(temporizador)
  }, [cargar])

  useEffect(() => {
    void api
      .get<{ priceLists: PriceListJson[] }>('/price-lists')
      .then((data) => setListas(data.priceLists))
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    void api
      .get<{ taxRates: TaxRateJson[] }>('/tax-rates')
      .then((data) => setAlicuotas(data.taxRates))
      .catch(() => undefined)
  }, [])

  const bajos = productos.filter((producto) => producto.belowMinimum).length

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col gap-4">
      <Encabezado titulo="Catálogo" subtitulo="Productos, precios y existencias">
        <Boton variante={soloBajos ? 'principal' : 'normal'} onClick={() => setSoloBajos((v) => !v)}>
          Por reponer{bajos > 0 && !soloBajos ? ` (${bajos})` : ''}
        </Boton>
        <Boton variante="principal" onClick={() => setCreando(true)}>
          Nuevo producto
        </Boton>
      </Encabezado>

      <Campo
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
        placeholder="Buscar por nombre, código o código de barras…"
        disabled={soloBajos}
      />

      {error ? <Aviso>{error}</Aviso> : null}

      <Tarjeta className="min-h-0 flex-1 overflow-auto">
        {productos.length === 0 ? (
          <Vacio>{soloBajos ? 'Nada por reponer.' : 'No hay productos que coincidan.'}</Vacio>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 border-b border-borde bg-lienzo text-xs uppercase tracking-wide text-apagado">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium">Producto</th>
                <th className="w-20 px-2 py-2.5 text-center font-medium">IVA</th>
                <th className="w-36 px-2 py-2.5 text-right font-medium">Precio</th>
                <th className="w-32 px-2 py-2.5 text-right font-medium">Existencia</th>
                <th className="w-24" />
              </tr>
            </thead>
            <tbody>
              {productos.map((producto) => (
                <tr
                  key={producto.productId}
                  className="border-b border-borde/60 transition last:border-0 hover:bg-tenue/50"
                >
                  <td className="px-4 py-2.5">
                    <span className="block font-medium text-tinta">{producto.name}</span>
                    <span className="cifra block text-xs text-apagado">
                      {producto.sku}
                      {producto.barcode ? ` · ${producto.barcode}` : ''}
                    </span>
                  </td>
                  <td className="px-2 py-2.5 text-center text-xs text-apagado">{producto.taxCode}</td>
                  <td className="cifra px-2 py-2.5 text-right">
                    <span className="block font-medium text-tinta">{formatMoney(convert(toMoney(producto.price), 'VES', rate))}</span>
                    <span className="block text-xs text-apagado">{formatMoney(toMoney(producto.price))}</span>
                  </td>
                  <td className="px-2 py-2.5 text-right">
                    {producto.tracksStock ? (
                      producto.belowMinimum ? (
                        <Insignia tono={BigInt(producto.stock) <= 0n ? 'error' : 'alerta'}>
                          {cantidad(BigInt(producto.stock))} {producto.unit}
                        </Insignia>
                      ) : (
                        <span className="cifra text-tinta">
                          {cantidad(BigInt(producto.stock))} {producto.unit}
                        </span>
                      )
                    ) : (
                      <Insignia>servicio</Insignia>
                    )}
                  </td>
                  <td className="px-2 py-2.5 text-right">
                    <div className="flex justify-end gap-1">
                      <Boton variante="plano" tamano="sm" onClick={() => setEditando(producto)}>
                        Editar
                      </Boton>
                      {producto.tracksStock ? (
                        <Boton variante="plano" tamano="sm" onClick={() => setAjustando(producto)}>
                          Ajustar
                        </Boton>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Tarjeta>

      {creando ? (
        <NuevoProducto
          alicuotas={alicuotas}
          onCerrar={() => setCreando(false)}
          onCreado={() => {
            setCreando(false)
            void cargar()
          }}
        />
      ) : null}

      {ajustando ? (
        <AjustarExistencia
          producto={ajustando}
          onCerrar={() => setAjustando(null)}
          onAjustado={() => {
            setAjustando(null)
            void cargar()
          }}
        />
      ) : null}

      {editando ? (
        <EditarProducto
          producto={editando}
          alicuotas={alicuotas}
          listas={listas}
          onCerrar={() => setEditando(null)}
          onGuardado={() => {
            setEditando(null)
            void cargar()
          }}
        />
      ) : null}
    </div>
  )
}

function EditarProducto({
  producto,
  alicuotas,
  listas,
  onCerrar,
  onGuardado,
}: {
  producto: ProductJson
  alicuotas: TaxRateJson[]
  listas: PriceListJson[]
  onCerrar: () => void
  onGuardado: () => void
}) {
  const [name, setName] = useState(producto.name)
  const [barcode, setBarcode] = useState(producto.barcode ?? '')
  const [precio, setPrecio] = useState(formatMoney(toMoney(producto.price), { symbol: false }))
  const [precioMayor, setPrecioMayor] = useState('')
  const [taxRateId, setTaxRateId] = useState(
    (alicuotas.find((a) => a.code === producto.taxCode) ?? alicuotas[0])?.id ?? '',
  )
  const [minimo, setMinimo] = useState(cantidad(BigInt(producto.minStock)))
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  const listaMayor = listas.find((l) => !l.isDefault)

  async function guardar() {
    const monto = aMonto(precio, 'USD')
    if (!monto) {
      setError('El precio no se entiende. Escriba por ejemplo 1,50.')
      return
    }
    const montoMayor = precioMayor.trim() ? aMonto(precioMayor, 'USD') : null
    if (precioMayor.trim() && !montoMayor) {
      setError('El precio mayor no se entiende.')
      return
    }
    setEnviando(true)
    setError(null)
    try {
      await api.patch(`/products/${producto.productId}`, {
        name: name.trim(),
        barcode: barcode.trim() || null,
        price: fromMoney(monto),
        ...(taxRateId ? { taxRateId } : {}),
        ...(aMilesimas(minimo) !== null ? { minStock: aMilesimas(minimo)!.toString() } : {}),
      })
      if (montoMayor && listaMayor) {
        await api.post(`/products/${producto.productId}/prices`, {
          priceListId: listaMayor.id,
          price: fromMoney(montoMayor),
        })
      }
      onGuardado()
    } catch (fallo) {
      setError(fallo instanceof ApiError ? fallo.message : 'No se pudo guardar el producto.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Modal titulo="Editar producto" descripcion={producto.sku} onCerrar={onCerrar}>
      <div className="space-y-3">
        <Campo etiqueta="Nombre" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <Campo etiqueta="Código de barras" value={barcode} onChange={(e) => setBarcode(e.target.value)} placeholder="opcional" />
        <div className="grid grid-cols-2 gap-3">
          <Campo
            etiqueta="Precio detal (USD)"
            value={precio}
            onChange={(e) => setPrecio(e.target.value)}
            className="cifra text-right"
          />
          <Select etiqueta="IVA" value={taxRateId} onChange={(e) => setTaxRateId(e.target.value)}>
            {alicuotas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </div>
        {listaMayor ? (
          <Campo
            etiqueta="Precio mayor (USD)"
            value={precioMayor}
            onChange={(e) => setPrecioMayor(e.target.value)}
            className="cifra text-right"
            placeholder="dejar vacío para no cambiarlo"
            ayuda="El precio al mayor. Se usa cuando en la venta se elige esa lista."
          />
        ) : null}
        {producto.tracksStock ? (
          <Campo
            etiqueta="Mínimo para avisar"
            value={minimo}
            onChange={(e) => setMinimo(e.target.value)}
            className="cifra text-right"
          />
        ) : null}

        {error ? <Aviso>{error}</Aviso> : null}

        <div className="flex justify-end gap-2 pt-2">
          <Boton variante="plano" onClick={onCerrar}>
            Cancelar
          </Boton>
          <Boton variante="principal" disabled={enviando || name.trim() === ''} onClick={() => void guardar()}>
            {enviando ? 'Guardando…' : 'Guardar'}
          </Boton>
        </div>
      </div>
    </Modal>
  )
}

function NuevoProducto({
  alicuotas,
  onCerrar,
  onCreado,
}: {
  alicuotas: TaxRateJson[]
  onCerrar: () => void
  onCreado: () => void
}) {
  const [sku, setSku] = useState('')
  const [name, setName] = useState('')
  const [barcode, setBarcode] = useState('')
  const [precio, setPrecio] = useState('')
  const [taxRateId, setTaxRateId] = useState('')
  const [existencia, setExistencia] = useState('')
  const [minimo, setMinimo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    if (!taxRateId && alicuotas.length > 0) {
      setTaxRateId((alicuotas.find((a) => a.isDefault) ?? alicuotas[0]!).id)
    }
  }, [alicuotas, taxRateId])

  async function guardar() {
    // El precio se ancla en dólares: es como piensa el precio un comerciante
    // venezolano, y el importe en bolívares sale de la tasa al vender.
    const monto = aMonto(precio, 'USD')
    if (!monto) {
      setError('El precio no se entiende. Escriba por ejemplo 1,50.')
      return
    }

    setError(null)
    setEnviando(true)
    try {
      await api.post('/products', {
        sku: sku.trim(),
        name: name.trim(),
        taxRateId,
        price: fromMoney(monto),
        ...(barcode.trim() ? { barcode: barcode.trim() } : {}),
        ...(aMilesimas(existencia) ? { initialStock: aMilesimas(existencia)!.toString() } : {}),
        ...(aMilesimas(minimo) ? { minStock: aMilesimas(minimo)!.toString() } : {}),
      })
      onCreado()
    } catch (fallo) {
      setError(fallo instanceof ApiError ? fallo.message : 'No se pudo crear el producto.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Modal titulo="Nuevo producto" descripcion="El precio se ancla en dólares." onCerrar={onCerrar}>
      <div className="space-y-3">
        <Campo etiqueta="Nombre" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <div className="grid grid-cols-2 gap-3">
          <Campo etiqueta="Código" value={sku} onChange={(e) => setSku(e.target.value)} />
          <Campo
            etiqueta="Código de barras"
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            placeholder="opcional"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Campo
            etiqueta="Precio en dólares"
            value={precio}
            onChange={(e) => setPrecio(e.target.value)}
            placeholder="1,50"
            className="cifra text-right"
            ayuda="El precio en Bs sale de la tasa al vender."
          />
          <Select etiqueta="IVA" value={taxRateId} onChange={(e) => setTaxRateId(e.target.value)}>
            {alicuotas.map((alicuota) => (
              <option key={alicuota.id} value={alicuota.id}>
                {alicuota.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Campo
            etiqueta="Existencia inicial"
            value={existencia}
            onChange={(e) => setExistencia(e.target.value)}
            placeholder="0"
            className="cifra text-right"
          />
          <Campo
            etiqueta="Mínimo para avisar"
            value={minimo}
            onChange={(e) => setMinimo(e.target.value)}
            placeholder="0"
            className="cifra text-right"
          />
        </div>

        {error ? <Aviso>{error}</Aviso> : null}

        <div className="flex justify-end gap-2 pt-2">
          <Boton variante="plano" onClick={onCerrar}>
            Cancelar
          </Boton>
          <Boton
            variante="principal"
            disabled={enviando || name.trim() === '' || sku.trim() === '' || precio.trim() === ''}
            onClick={() => void guardar()}
          >
            {enviando ? 'Guardando…' : 'Crear'}
          </Boton>
        </div>
      </div>
    </Modal>
  )
}

function AjustarExistencia({
  producto,
  onCerrar,
  onAjustado,
}: {
  producto: ProductJson
  onCerrar: () => void
  onAjustado: () => void
}) {
  const [diferencia, setDiferencia] = useState('')
  const [salida, setSalida] = useState(false)
  const [razon, setRazon] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function guardar() {
    const magnitud = aMilesimas(diferencia)
    if (!magnitud || magnitud === 0n) {
      setError('La cantidad no se entiende.')
      return
    }

    setError(null)
    setEnviando(true)
    try {
      await api.post(`/products/${producto.productId}/adjust-stock`, {
        quantity: (salida ? -magnitud : magnitud).toString(),
        reason: razon.trim(),
      })
      onAjustado()
    } catch (fallo) {
      setError(fallo instanceof ApiError ? fallo.message : 'No se pudo ajustar.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Modal titulo="Ajustar existencia" descripcion={producto.name} onCerrar={onCerrar}>
      <p className="cifra mb-4 rounded-lg bg-tenue px-3 py-2 text-sm text-apagado">
        Existencia actual: <span className="font-medium text-tinta">{cantidad(BigInt(producto.stock))} {producto.unit}</span>
      </p>

      <div className="space-y-3">
        <Segmentado
          valor={salida ? 'salida' : 'entrada'}
          onCambio={(v) => setSalida(v === 'salida')}
          opciones={[
            { valor: 'entrada', nombre: 'Entrada' },
            { valor: 'salida', nombre: 'Salida' },
          ]}
        />

        <Campo
          etiqueta="Cantidad"
          value={diferencia}
          onChange={(e) => setDiferencia(e.target.value)}
          className="cifra text-right"
          autoFocus
        />

        <Campo
          etiqueta="Razón"
          value={razon}
          onChange={(e) => setRazon(e.target.value)}
          placeholder="Merma por humedad, conteo físico…"
          ayuda="Todo ajuste queda registrado con su razón."
        />

        {error ? <Aviso>{error}</Aviso> : null}

        <div className="flex justify-end gap-2 pt-2">
          <Boton variante="plano" onClick={onCerrar}>
            Cancelar
          </Boton>
          <Boton
            variante="principal"
            disabled={enviando || diferencia.trim() === '' || razon.trim() === ''}
            onClick={() => void guardar()}
          >
            {enviando ? 'Guardando…' : 'Ajustar'}
          </Boton>
        </div>
      </div>
    </Modal>
  )
}
