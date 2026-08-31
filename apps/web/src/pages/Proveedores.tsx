import { useCallback, useEffect, useMemo, useState } from 'react'
import { formatMoney, money, type Money } from '@fve/money'

import {
  ApiError,
  api,
  fromMoney,
  toMoney,
  type FullPurchaseJson,
  type ProductJson,
  type PurchaseSummaryJson,
  type SupplierJson,
} from '../api'
import { aMilesimas, aMonto, cantidad } from '../formato'
import {
  Aviso,
  Boton,
  CabeceraTarjeta,
  Campo,
  Encabezado,
  Insignia,
  Modal,
  Segmentado,
  Select,
  Tarjeta,
  Vacio,
} from '../components/ui'

export function Proveedores() {
  const [vista, setVista] = useState<'directorio' | 'compras'>('directorio')

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col gap-4">
      <Encabezado titulo="Proveedores" subtitulo="Directorio de proveedores y facturas de compra">
        <Segmentado
          valor={vista}
          onCambio={setVista}
          opciones={[
            { valor: 'directorio', nombre: 'Directorio' },
            { valor: 'compras', nombre: 'Compras' },
          ]}
        />
      </Encabezado>

      {vista === 'directorio' ? <Directorio /> : <Compras />}
    </div>
  )
}

// --- Directorio de proveedores ----------------------------------------------

function Directorio() {
  const [proveedores, setProveedores] = useState<SupplierJson[]>([])
  const [busqueda, setBusqueda] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [editando, setEditando] = useState<SupplierJson | null>(null)
  const [creando, setCreando] = useState(false)

  const cargar = useCallback(async () => {
    try {
      const d = await api.get<{ suppliers: SupplierJson[] }>(
        `/suppliers?q=${encodeURIComponent(busqueda.trim())}&limit=200`,
      )
      setProveedores(d.suppliers)
      setError(null)
    } catch (fallo) {
      setError(fallo instanceof ApiError ? fallo.message : 'No se pudieron cargar los proveedores.')
    }
  }, [busqueda])

  useEffect(() => {
    const t = setTimeout(() => void cargar(), 150)
    return () => clearTimeout(t)
  }, [cargar])

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-56 flex-1">
          <Campo
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por nombre o RIF…"
          />
        </div>
        <Boton variante="principal" onClick={() => setCreando(true)}>
          Nuevo proveedor
        </Boton>
      </div>

      {error ? <Aviso>{error}</Aviso> : null}

      <Tarjeta className="min-h-0 flex-1 overflow-auto">
        {proveedores.length === 0 ? (
          <Vacio>No hay proveedores que coincidan.</Vacio>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 border-b border-borde bg-lienzo text-xs uppercase tracking-wide text-apagado">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium">Proveedor</th>
                <th className="px-2 py-2.5 text-left font-medium">Contacto</th>
                <th className="w-24 px-2 py-2.5 text-right font-medium">Compras</th>
                <th className="w-20" />
              </tr>
            </thead>
            <tbody>
              {proveedores.map((p) => (
                <tr key={p.supplierId} className="border-b border-borde/60 transition last:border-0 hover:bg-tenue/50">
                  <td className="px-4 py-2.5">
                    <span className="block font-medium text-tinta">{p.name}</span>
                    <span className="cifra block text-xs text-apagado">{p.id}</span>
                  </td>
                  <td className="px-2 py-2.5 text-apagado">
                    {p.contactName ?? '—'}
                    {p.phone ? <span className="cifra block text-xs">{p.phone}</span> : null}
                  </td>
                  <td className="cifra px-2 py-2.5 text-right text-apagado">{p.purchaseCount}</td>
                  <td className="px-2 py-2.5 text-right">
                    <Boton variante="plano" tamano="sm" onClick={() => setEditando(p)}>
                      Editar
                    </Boton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Tarjeta>

      {creando ? (
        <FormularioProveedor
          onCerrar={() => setCreando(false)}
          onGuardado={() => {
            setCreando(false)
            void cargar()
          }}
        />
      ) : null}
      {editando ? (
        <FormularioProveedor
          proveedor={editando}
          onCerrar={() => setEditando(null)}
          onGuardado={() => {
            setEditando(null)
            void cargar()
          }}
        />
      ) : null}
    </>
  )
}

function FormularioProveedor({
  proveedor,
  onCerrar,
  onGuardado,
}: {
  proveedor?: SupplierJson | undefined
  onCerrar: () => void
  onGuardado: () => void
}) {
  const esNuevo = !proveedor
  const [idKind, setIdKind] = useState<'V' | 'E' | 'J' | 'G' | 'P'>('J')
  const [idNumber, setIdNumber] = useState(proveedor ? proveedor.id.split('-').slice(1).join('-') : '')
  const [name, setName] = useState(proveedor?.name ?? '')
  const [contactName, setContactName] = useState(proveedor?.contactName ?? '')
  const [phone, setPhone] = useState(proveedor?.phone ?? '')
  const [email, setEmail] = useState(proveedor?.email ?? '')
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function guardar() {
    setEnviando(true)
    setError(null)
    try {
      if (esNuevo) {
        await api.post('/suppliers', {
          idKind,
          idNumber: idNumber.trim(),
          name: name.trim(),
          ...(contactName.trim() ? { contactName: contactName.trim() } : {}),
          ...(phone.trim() ? { phone: phone.trim() } : {}),
          ...(email.trim() ? { email: email.trim() } : {}),
        })
      } else {
        await api.patch(`/suppliers/${proveedor!.supplierId}`, {
          name: name.trim(),
          contactName: contactName.trim() || null,
          phone: phone.trim() || null,
          email: email.trim() || null,
        })
      }
      onGuardado()
    } catch (fallo) {
      setError(fallo instanceof ApiError ? fallo.message : 'No se pudo guardar el proveedor.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Modal titulo={esNuevo ? 'Nuevo proveedor' : 'Editar proveedor'} onCerrar={onCerrar}>
      <div className="space-y-3">
        <Campo etiqueta="Nombre o razón social" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        {esNuevo ? (
          <div className="grid grid-cols-[90px_1fr] gap-3">
            <Select etiqueta="Tipo" value={idKind} onChange={(e) => setIdKind(e.target.value as typeof idKind)}>
              {(['J', 'G', 'V', 'E', 'P'] as const).map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </Select>
            <Campo etiqueta="RIF" value={idNumber} onChange={(e) => setIdNumber(e.target.value)} className="cifra" />
          </div>
        ) : null}
        <Campo etiqueta="Persona de contacto" value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="opcional" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Campo etiqueta="Teléfono" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="opcional" className="cifra" />
          <Campo etiqueta="Correo" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="opcional" />
        </div>

        {error ? <Aviso>{error}</Aviso> : null}

        <div className="flex justify-end gap-2 pt-1">
          <Boton variante="plano" onClick={onCerrar}>
            Cancelar
          </Boton>
          <Boton
            variante="principal"
            disabled={enviando || name.trim() === '' || (esNuevo && idNumber.trim() === '')}
            onClick={() => void guardar()}
          >
            {enviando ? 'Guardando…' : esNuevo ? 'Crear' : 'Guardar'}
          </Boton>
        </div>
      </div>
    </Modal>
  )
}

// --- Compras ----------------------------------------------------------------

function Compras() {
  const [compras, setCompras] = useState<PurchaseSummaryJson[]>([])
  const [error, setError] = useState<string | null>(null)
  const [registrando, setRegistrando] = useState(false)
  const [viendo, setViendo] = useState<FullPurchaseJson | null>(null)

  const cargar = useCallback(async () => {
    try {
      const d = await api.get<{ purchases: PurchaseSummaryJson[] }>('/purchases?limit=200')
      setCompras(d.purchases)
      setError(null)
    } catch (fallo) {
      setError(fallo instanceof ApiError ? fallo.message : 'No se pudieron cargar las compras.')
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  async function ver(purchaseId: string) {
    try {
      const d = await api.get<{ purchase: FullPurchaseJson }>(`/purchases/${purchaseId}`)
      setViendo(d.purchase)
    } catch (fallo) {
      setError(fallo instanceof ApiError ? fallo.message : 'No se pudo abrir la compra.')
    }
  }

  return (
    <>
      <div className="flex justify-end">
        <Boton variante="principal" onClick={() => setRegistrando(true)}>
          Registrar compra
        </Boton>
      </div>

      {error ? <Aviso>{error}</Aviso> : null}

      <Tarjeta className="min-h-0 flex-1 overflow-auto">
        {compras.length === 0 ? (
          <Vacio>Todavía no hay compras registradas.</Vacio>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 border-b border-borde bg-lienzo text-xs uppercase tracking-wide text-apagado">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium">Factura</th>
                <th className="px-2 py-2.5 text-left font-medium">Proveedor</th>
                <th className="w-32 px-2 py-2.5 text-right font-medium">Fecha</th>
                <th className="w-36 px-4 py-2.5 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {compras.map((c) => (
                <tr
                  key={c.purchaseId}
                  onClick={() => void ver(c.purchaseId)}
                  className="cursor-pointer border-b border-borde/60 transition last:border-0 hover:bg-tenue/60"
                >
                  <td className="px-4 py-2.5">
                    <span className="cifra block font-medium text-tinta">{c.invoiceNumber}</span>
                    {c.controlNumber ? <span className="cifra block text-xs text-apagado">Control {c.controlNumber}</span> : null}
                  </td>
                  <td className="px-2 py-2.5 text-tinta">{c.supplierName}</td>
                  <td className="cifra px-2 py-2.5 text-right text-apagado">
                    {new Date(c.occurredAt).toLocaleDateString('es-VE')}
                  </td>
                  <td className="cifra px-4 py-2.5 text-right">
                    <span className="block font-medium text-tinta">{formatMoney(toMoney(c.totalVes))}</span>
                    <span className="block text-xs text-apagado">{formatMoney(toMoney(c.totalUsd))}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Tarjeta>

      {registrando ? (
        <RegistrarCompra
          onCerrar={() => setRegistrando(false)}
          onRegistrada={() => {
            setRegistrando(false)
            void cargar()
          }}
        />
      ) : null}
      {viendo ? <VerCompra compra={viendo} onCerrar={() => setViendo(null)} /> : null}
    </>
  )
}

interface LineaCompra {
  clave: string
  productId: string | null
  descripcion: string
  cantidad: string
  costo: string
}

function RegistrarCompra({
  onCerrar,
  onRegistrada,
}: {
  onCerrar: () => void
  onRegistrada: () => void
}) {
  const [proveedor, setProveedor] = useState<SupplierJson | null>(null)
  const [buscarProv, setBuscarProv] = useState('')
  const [provResultados, setProvResultados] = useState<SupplierJson[]>([])
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [controlNumber, setControlNumber] = useState('')
  const [moneda, setMoneda] = useState<'USD' | 'VES'>('USD')
  const [lineas, setLineas] = useState<LineaCompra[]>([])
  const [ivaTexto, setIvaTexto] = useState('')
  const [notas, setNotas] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  // Búsqueda de proveedor.
  useEffect(() => {
    if (proveedor) return
    const t = setTimeout(() => {
      void api
        .get<{ suppliers: SupplierJson[] }>(`/suppliers?q=${encodeURIComponent(buscarProv.trim())}&limit=6`)
        .then((d) => setProvResultados(d.suppliers))
        .catch(() => setProvResultados([]))
    }, 150)
    return () => clearTimeout(t)
  }, [buscarProv, proveedor])

  // Búsqueda de producto para agregar renglón.
  const [buscarProd, setBuscarProd] = useState('')
  const [prodResultados, setProdResultados] = useState<ProductJson[]>([])
  useEffect(() => {
    if (buscarProd.trim() === '') {
      setProdResultados([])
      return
    }
    const t = setTimeout(() => {
      void api
        .get<{ products: ProductJson[] }>(`/products?q=${encodeURIComponent(buscarProd.trim())}&limit=6`)
        .then((d) => setProdResultados(d.products))
        .catch(() => setProdResultados([]))
    }, 150)
    return () => clearTimeout(t)
  }, [buscarProd])

  function agregarProducto(p: ProductJson) {
    setLineas((a) => [
      ...a,
      { clave: `${p.productId}-${a.length}`, productId: p.productId, descripcion: p.name, cantidad: '1', costo: '' },
    ])
    setBuscarProd('')
    setProdResultados([])
  }

  function agregarLibre() {
    setLineas((a) => [...a, { clave: `libre-${a.length}-${Date.now()}`, productId: null, descripcion: '', cantidad: '1', costo: '' }])
  }

  function cambiarLinea(clave: string, campo: keyof LineaCompra, valor: string) {
    setLineas((a) => a.map((l) => (l.clave === clave ? { ...l, [campo]: valor } : l)))
  }

  function quitarLinea(clave: string) {
    setLineas((a) => a.filter((l) => l.clave !== clave))
  }

  const totalLinea = (l: LineaCompra): Money | null => {
    const qty = aMilesimas(l.cantidad)
    const costo = aMonto(l.costo, moneda)
    if (qty === null || !costo) return null
    return money(moneda, (costo.amount * qty + 500n) / 1000n)
  }

  const subtotal = useMemo(
    () =>
      lineas.reduce<Money>((acc, l) => {
        const t = totalLinea(l)
        return t ? money(moneda, acc.amount + t.amount) : acc
      }, money(moneda, 0n)),
    [lineas, moneda],
  )
  const iva = aMonto(ivaTexto, moneda) ?? money(moneda, 0n)
  const total = money(moneda, subtotal.amount + iva.amount)

  const puedeGuardar =
    proveedor !== null &&
    invoiceNumber.trim() !== '' &&
    lineas.length > 0 &&
    lineas.every((l) => l.descripcion.trim() !== '' && totalLinea(l) !== null)

  async function guardar() {
    if (!proveedor) return
    setEnviando(true)
    setError(null)
    try {
      await api.post('/purchases', {
        supplierId: proveedor.supplierId,
        invoiceNumber: invoiceNumber.trim(),
        ...(controlNumber.trim() ? { controlNumber: controlNumber.trim() } : {}),
        currency: moneda,
        iva: fromMoney(iva),
        ...(notas.trim() ? { notes: notas.trim() } : {}),
        lines: lineas.map((l) => ({
          ...(l.productId ? { productId: l.productId } : {}),
          description: l.descripcion.trim(),
          quantity: aMilesimas(l.cantidad)!.toString(),
          unitCost: fromMoney(aMonto(l.costo, moneda)!),
        })),
      })
      onRegistrada()
    } catch (fallo) {
      setError(fallo instanceof ApiError ? fallo.message : 'No se pudo registrar la compra.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Modal titulo="Registrar compra" descripcion="Copie los datos de la factura del proveedor." onCerrar={onCerrar} ancho="lg">
      <div className="space-y-4">
        {/* Proveedor */}
        <div className="relative">
          {proveedor ? (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-borde bg-tenue px-3 py-2">
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-tinta">{proveedor.name}</span>
                <span className="cifra block text-xs text-apagado">{proveedor.id}</span>
              </span>
              <Boton variante="plano" tamano="sm" onClick={() => setProveedor(null)}>
                Cambiar
              </Boton>
            </div>
          ) : (
            <>
              <Campo
                etiqueta="Proveedor"
                value={buscarProv}
                onChange={(e) => setBuscarProv(e.target.value)}
                placeholder="Buscar por nombre o RIF…"
                autoFocus
              />
              {provResultados.length > 0 ? (
                <ul className="surgir absolute inset-x-0 z-20 mt-1 max-h-48 overflow-auto rounded-xl border border-borde bg-lienzo p-1 shadow-flotante">
                  {provResultados.map((p) => (
                    <li key={p.supplierId}>
                      <button
                        onClick={() => {
                          setProveedor(p)
                          setBuscarProv('')
                          setProvResultados([])
                        }}
                        className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left transition hover:bg-tenue"
                      >
                        <span className="text-sm font-medium text-tinta">{p.name}</span>
                        <span className="cifra text-xs text-apagado">{p.id}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_100px]">
          <Campo etiqueta="N° de factura" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} className="cifra" />
          <Campo etiqueta="N° de control" value={controlNumber} onChange={(e) => setControlNumber(e.target.value)} className="cifra" placeholder="opcional" />
          <Select etiqueta="Moneda" value={moneda} onChange={(e) => setMoneda(e.target.value as 'USD' | 'VES')}>
            <option value="USD">$</option>
            <option value="VES">Bs</option>
          </Select>
        </div>

        {/* Renglones */}
        <div>
          <div className="relative mb-2">
            <Campo
              value={buscarProd}
              onChange={(e) => setBuscarProd(e.target.value)}
              placeholder="Agregar producto del catálogo…"
            />
            {prodResultados.length > 0 ? (
              <ul className="surgir absolute inset-x-0 z-20 mt-1 max-h-48 overflow-auto rounded-xl border border-borde bg-lienzo p-1 shadow-flotante">
                {prodResultados.map((p) => (
                  <li key={p.productId}>
                    <button
                      onClick={() => agregarProducto(p)}
                      className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left transition hover:bg-tenue"
                    >
                      <span className="text-sm text-tinta">{p.name}</span>
                      <span className="cifra text-xs text-apagado">{p.sku}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          {lineas.length === 0 ? (
            <div className="rounded-lg border border-dashed border-borde px-3 py-4 text-center text-sm text-apagado">
              Agregue productos del catálogo (suman inventario) o una línea libre.
            </div>
          ) : (
            <div className="space-y-2">
              {lineas.map((l) => {
                const t = totalLinea(l)
                return (
                  <div key={l.clave} className="flex items-center gap-2 rounded-lg border border-borde px-2 py-2">
                    <div className="min-w-0 flex-1">
                      {l.productId ? (
                        <span className="block truncate text-sm font-medium text-tinta">{l.descripcion}</span>
                      ) : (
                        <input
                          value={l.descripcion}
                          onChange={(e) => cambiarLinea(l.clave, 'descripcion', e.target.value)}
                          placeholder="Descripción"
                          className="h-8 w-full rounded-md border border-borde bg-lienzo px-2 text-sm outline-none focus:border-acento"
                        />
                      )}
                      {t ? <span className="cifra block text-xs text-apagado">{formatMoney(t)}</span> : null}
                    </div>
                    <input
                      value={l.cantidad}
                      onChange={(e) => cambiarLinea(l.clave, 'cantidad', e.target.value)}
                      className="cifra h-8 w-16 rounded-md border border-borde bg-lienzo px-2 text-right text-sm outline-none focus:border-acento"
                      placeholder="Cant."
                    />
                    <input
                      value={l.costo}
                      onChange={(e) => cambiarLinea(l.clave, 'costo', e.target.value)}
                      className="cifra h-8 w-24 rounded-md border border-borde bg-lienzo px-2 text-right text-sm outline-none focus:border-acento"
                      placeholder="Costo"
                    />
                    <button
                      onClick={() => quitarLinea(l.clave)}
                      aria-label="Quitar"
                      className="shrink-0 rounded-md p-1 text-apagado transition hover:bg-error-tenue hover:text-error"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round">
                        <path d="M18 6 6 18M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                )
              })}
              <Boton variante="plano" tamano="sm" onClick={agregarLibre}>
                + Línea libre
              </Boton>
            </div>
          )}
        </div>

        {/* Totales */}
        <div className="space-y-2 rounded-lg bg-tenue px-3 py-2.5">
          <div className="flex items-center justify-between text-sm">
            <span className="text-apagado">Subtotal</span>
            <span className="cifra font-medium text-tinta">{formatMoney(subtotal)}</span>
          </div>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-apagado">IVA de la factura</span>
            <input
              value={ivaTexto}
              onChange={(e) => setIvaTexto(e.target.value)}
              placeholder="0,00"
              className="cifra h-8 w-28 rounded-md border border-borde bg-lienzo px-2 text-right outline-none focus:border-acento"
            />
          </div>
          <div className="flex items-center justify-between border-t border-borde pt-2 text-base font-semibold">
            <span>Total</span>
            <span className="cifra">{formatMoney(total)}</span>
          </div>
        </div>

        <Campo etiqueta="Notas" value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="opcional" />

        {error ? <Aviso>{error}</Aviso> : null}

        <div className="flex justify-end gap-2">
          <Boton variante="plano" onClick={onCerrar}>
            Cancelar
          </Boton>
          <Boton variante="principal" disabled={enviando || !puedeGuardar} onClick={() => void guardar()}>
            {enviando ? 'Guardando…' : 'Registrar compra'}
          </Boton>
        </div>
      </div>
    </Modal>
  )
}

function VerCompra({ compra, onCerrar }: { compra: FullPurchaseJson; onCerrar: () => void }) {
  return (
    <Modal titulo={`Compra ${compra.invoiceNumber}`} descripcion={compra.supplier.name} onCerrar={onCerrar} ancho="lg">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <span className="text-xs uppercase tracking-wide text-apagado">Proveedor</span>
            <p className="font-medium text-tinta">{compra.supplier.name}</p>
            <p className="cifra text-xs text-apagado">{compra.supplier.id}</p>
          </div>
          <div className="text-right">
            <span className="text-xs uppercase tracking-wide text-apagado">Fecha</span>
            <p className="cifra">{new Date(compra.occurredAt).toLocaleDateString('es-VE')}</p>
            {compra.controlNumber ? <p className="cifra text-xs text-apagado">Control {compra.controlNumber}</p> : null}
          </div>
        </div>

        <Tarjeta plano className="overflow-hidden">
          <CabeceraTarjeta>Renglones</CabeceraTarjeta>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody>
                {compra.lines.map((l, i) => (
                  <tr key={i} className="border-b border-borde/60 last:border-0">
                    <td className="px-3 py-2">
                      <span className="block text-tinta">{l.description}</span>
                      {l.sku ? <span className="cifra block text-xs text-apagado">{l.sku}</span> : null}
                    </td>
                    <td className="cifra px-2 py-2 text-right text-apagado">
                      {cantidad(BigInt(l.quantity))} × {formatMoney(toMoney(l.unitCost))}
                    </td>
                    <td className="cifra px-3 py-2 text-right font-medium text-tinta">{formatMoney(toMoney(l.lineTotal))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Tarjeta>

        <div className="ml-auto w-56 space-y-1 text-sm">
          <div className="flex justify-between text-apagado">
            <span>Subtotal</span>
            <span className="cifra text-tinta">{formatMoney(toMoney(compra.net))}</span>
          </div>
          <div className="flex justify-between text-apagado">
            <span>IVA</span>
            <span className="cifra text-tinta">{formatMoney(toMoney(compra.iva))}</span>
          </div>
          <div className="flex justify-between border-t border-borde pt-1 text-base font-semibold">
            <span>Total</span>
            <span className="cifra">{formatMoney(toMoney(compra.total))}</span>
          </div>
        </div>

        {compra.notes ? <p className="rounded-lg bg-tenue px-3 py-2 text-sm text-apagado">{compra.notes}</p> : null}

        <div className="flex justify-end">
          <Boton variante="plano" onClick={onCerrar}>
            Cerrar
          </Boton>
        </div>
      </div>
    </Modal>
  )
}
