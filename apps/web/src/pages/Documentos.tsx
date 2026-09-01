import { useCallback, useEffect, useState } from 'react'
import { formatMoney } from '@fve/money'

import {
  ApiError,
  api,
  toMoney,
  type ControlBookJson,
  type DocumentKind,
  type DocumentSummaryJson,
  type FullDocumentJson,
  type IssuerJson,
} from '../api'
import {
  Aviso,
  Boton,
  Campo,
  Encabezado,
  Insignia,
  Modal,
  Select,
  Tarjeta,
  Vacio,
} from '../components/ui'
import { VisorDocumento } from '../components/DocumentoImprimible'

const TITULOS: Record<DocumentKind, string> = {
  FACTURA: 'Factura',
  PRESUPUESTO: 'Presupuesto',
  NOTA_ENTREGA: 'Nota de entrega',
  RECIBO: 'Recibo',
  NOTA_CREDITO: 'Nota de crédito',
}

const TONOS: Record<DocumentKind, 'acento' | 'neutro'> = {
  FACTURA: 'acento',
  PRESUPUESTO: 'neutro',
  NOTA_ENTREGA: 'neutro',
  RECIBO: 'neutro',
  NOTA_CREDITO: 'neutro',
}

export function Documentos({ onConvertir }: { onConvertir?: ((documento: FullDocumentJson) => void) | undefined }) {
  const [docs, setDocs] = useState<DocumentSummaryJson[]>([])
  const [busqueda, setBusqueda] = useState('')
  const [kind, setKind] = useState<DocumentKind | ''>('')
  const [error, setError] = useState<string | null>(null)
  const [abierto, setAbierto] = useState<FullDocumentJson | null>(null)
  const [config, setConfig] = useState<'emisor' | 'talonario' | null>(null)

  const cargar = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      if (busqueda.trim()) params.set('q', busqueda.trim())
      if (kind) params.set('kind', kind)
      params.set('limit', '200')
      const data = await api.get<{ documents: DocumentSummaryJson[] }>(`/documents?${params.toString()}`)
      setDocs(data.documents)
      setError(null)
    } catch (fallo) {
      setError(fallo instanceof ApiError ? fallo.message : 'No se pudieron cargar los documentos.')
    }
  }, [busqueda, kind])

  useEffect(() => {
    const t = setTimeout(() => void cargar(), 150)
    return () => clearTimeout(t)
  }, [cargar])

  async function abrir(documentId: string) {
    try {
      const data = await api.get<{ document: FullDocumentJson }>(`/documents/${documentId}`)
      setAbierto(data.document)
    } catch (fallo) {
      setError(fallo instanceof ApiError ? fallo.message : 'No se pudo abrir el documento.')
    }
  }

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col gap-4">
      <Encabezado titulo="Documentos" subtitulo="Facturas, notas de entrega, presupuestos y recibos">
        <Boton variante="normal" onClick={() => setConfig('talonario')}>
          Talonario
        </Boton>
        <Boton variante="normal" onClick={() => setConfig('emisor')}>
          Datos del emisor
        </Boton>
      </Encabezado>

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-56 flex-1">
          <Campo
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por número, N° de control o cliente…"
          />
        </div>
        <Select value={kind} onChange={(e) => setKind(e.target.value as DocumentKind | '')} className="w-48">
          <option value="">Todos los tipos</option>
          {(Object.keys(TITULOS) as DocumentKind[]).map((k) => (
            <option key={k} value={k}>
              {TITULOS[k]}
            </option>
          ))}
        </Select>
      </div>

      {error ? <Aviso>{error}</Aviso> : null}

      <Tarjeta className="min-h-0 flex-1 overflow-auto">
        {docs.length === 0 ? (
          <Vacio>No hay documentos que coincidan.</Vacio>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 border-b border-borde bg-lienzo text-xs uppercase tracking-wide text-apagado">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium">Documento</th>
                <th className="px-2 py-2.5 text-left font-medium">Cliente</th>
                <th className="w-32 px-2 py-2.5 text-right font-medium">Fecha</th>
                <th className="w-36 px-4 py-2.5 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((doc) => (
                <tr
                  key={doc.documentId}
                  onClick={() => void abrir(doc.documentId)}
                  className="cursor-pointer border-b border-borde/60 transition last:border-0 hover:bg-tenue/60"
                >
                  <td className="px-4 py-2.5">
                    <span className="flex items-center gap-2">
                      <Insignia tono={TONOS[doc.kind]}>{TITULOS[doc.kind]}</Insignia>
                      <span className="cifra font-medium text-tinta">{doc.fullNumber}</span>
                      {doc.status === 'VOIDED' ? <Insignia tono="error">anulado</Insignia> : null}
                    </span>
                    {doc.controlNumber ? (
                      <span className="cifra mt-0.5 block text-xs text-apagado">Control {doc.controlNumber}</span>
                    ) : null}
                  </td>
                  <td className="px-2 py-2.5 text-tinta">{doc.customerName}</td>
                  <td className="cifra px-2 py-2.5 text-right text-apagado">
                    {doc.issuedAt ? new Date(doc.issuedAt).toLocaleDateString('es-VE') : '—'}
                  </td>
                  <td className="cifra px-4 py-2.5 text-right">
                    <span className="block font-medium text-tinta">{formatMoney(toMoney(doc.totalVes))}</span>
                    <span className="block text-xs text-apagado">{formatMoney(toMoney(doc.totalUsd))}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Tarjeta>

      {abierto ? (
        <VisorDocumento
          documento={abierto}
          onCerrar={() => setAbierto(null)}
          onAnulado={() => void cargar()}
          {...(onConvertir
            ? { onConvertir: (d: FullDocumentJson) => { setAbierto(null); onConvertir(d) } }
            : {})}
        />
      ) : null}
      {config === 'emisor' ? <ConfigEmisor onCerrar={() => setConfig(null)} /> : null}
      {config === 'talonario' ? <ConfigTalonario onCerrar={() => setConfig(null)} /> : null}
    </div>
  )
}

/** Datos de la empresa que salen impresos en cada documento. */
function ConfigEmisor({ onCerrar }: { onCerrar: () => void }) {
  const [emisor, setEmisor] = useState<IssuerJson | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    void api
      .get<{ issuer: IssuerJson }>('/issuer')
      .then((d) => setEmisor(d.issuer))
      .catch(() => setError('No se pudieron cargar los datos del emisor.'))
  }, [])

  function set<K extends keyof IssuerJson>(campo: K, valor: IssuerJson[K]) {
    setEmisor((actual) => (actual ? { ...actual, [campo]: valor } : actual))
  }

  async function guardar() {
    if (!emisor) return
    setGuardando(true)
    setError(null)
    try {
      await api.patch('/issuer', {
        tradeName: emisor.name || null,
        legalName: emisor.legalName,
        address: emisor.address,
        city: emisor.city,
        phone: emisor.phone,
        email: emisor.email || null,
        website: emisor.website,
        documentFooter: emisor.footer,
      })
      onCerrar()
    } catch (fallo) {
      setError(fallo instanceof ApiError ? fallo.message : 'No se pudieron guardar los datos.')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Modal
      titulo="Datos del emisor"
      descripcion="Encabezado y pie que salen impresos en cada documento."
      onCerrar={onCerrar}
      ancho="lg"
    >
      {!emisor ? (
        <Vacio>Cargando…</Vacio>
      ) : (
        <div className="space-y-3">
          <div className="rounded-lg bg-tenue px-3 py-2 text-xs text-apagado">
            <span className="cifra font-medium text-tinta">RIF {emisor.rif}</span> · el RIF y el nombre legal
            del negocio se fijan al darlo de alta; aquí se completa el resto.
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Campo etiqueta="Nombre comercial" value={emisor.name} onChange={(e) => set('name', e.target.value)} />
            <Campo
              etiqueta="Razón social"
              value={emisor.legalName ?? ''}
              onChange={(e) => set('legalName', e.target.value)}
              placeholder="si difiere del comercial"
            />
          </div>
          <Campo etiqueta="Dirección" value={emisor.address ?? ''} onChange={(e) => set('address', e.target.value)} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Campo etiqueta="Ciudad" value={emisor.city ?? ''} onChange={(e) => set('city', e.target.value)} />
            <Campo etiqueta="Teléfono" value={emisor.phone ?? ''} onChange={(e) => set('phone', e.target.value)} className="cifra" />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Campo etiqueta="Correo" type="email" value={emisor.email ?? ''} onChange={(e) => set('email', e.target.value)} />
            <Campo etiqueta="Sitio web" value={emisor.website ?? ''} onChange={(e) => set('website', e.target.value)} />
          </div>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-tinta">Pie del documento</span>
            <textarea
              value={emisor.footer ?? ''}
              onChange={(e) => set('footer', e.target.value)}
              rows={2}
              placeholder="Condiciones de pago, garantía, agradecimiento…"
              className="w-full rounded-lg border border-borde bg-lienzo px-3 py-2 text-sm outline-none transition focus:border-acento focus:ring-2 focus:ring-acento/20"
            />
          </label>

          {error ? <Aviso>{error}</Aviso> : null}

          <div className="flex justify-end gap-2 pt-1">
            <Boton variante="plano" onClick={onCerrar}>
              Cancelar
            </Boton>
            <Boton variante="principal" disabled={guardando} onClick={() => void guardar()}>
              {guardando ? 'Guardando…' : 'Guardar'}
            </Boton>
          </div>
        </div>
      )}
    </Modal>
  )
}

/** Rango de números de control del talonario de la imprenta autorizada. */
function ConfigTalonario({ onCerrar }: { onCerrar: () => void }) {
  const [libros, setLibros] = useState<ControlBookJson[]>([])
  const [prefijo, setPrefijo] = useState('')
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  const cargar = useCallback(async () => {
    try {
      const d = await api.get<{ books: ControlBookJson[] }>('/control-books')
      setLibros(d.books)
    } catch {
      setError('No se pudo cargar el estado del talonario.')
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const factura = libros.find((l) => l.kind === 'FACTURA')

  async function guardar() {
    const from = Number(desde)
    const to = Number(hasta)
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from) {
      setError('Revise el rango: «desde» y «hasta» deben ser enteros y «hasta» no puede ser menor.')
      return
    }
    setGuardando(true)
    setError(null)
    try {
      await api.post('/control-books', {
        kind: 'FACTURA',
        prefix: prefijo.trim() || null,
        from,
        to,
      })
      setPrefijo('')
      setDesde('')
      setHasta('')
      await cargar()
    } catch (fallo) {
      setError(fallo instanceof ApiError ? fallo.message : 'No se pudo cargar el talonario.')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Modal
      titulo="Talonario de facturas"
      descripcion="Números de control preimpresos por la imprenta autorizada."
      onCerrar={onCerrar}
    >
      <div className="space-y-4">
        <div className="rounded-lg bg-tenue px-3 py-2.5 text-sm">
          {factura && factura.next !== null ? (
            <div className="flex items-center justify-between">
              <span className="text-apagado">En el talonario</span>
              <span className="text-right">
                <span className="cifra block font-medium text-tinta">
                  {factura.prefix ?? ''}
                  {factura.next} → {factura.prefix ?? ''}
                  {factura.last}
                </span>
                <span className="text-xs text-apagado">
                  quedan {factura.remaining} número{factura.remaining === 1 ? '' : 's'}
                </span>
              </span>
            </div>
          ) : (
            <span className="text-apagado">Todavía no hay un talonario cargado. Sin él, la factura sale sin número de control.</span>
          )}
        </div>

        <div className="space-y-3">
          <span className="block text-sm font-medium text-tinta">Cargar un talonario nuevo</span>
          <div className="grid grid-cols-[1fr_1fr_1fr] gap-3">
            <Campo etiqueta="Prefijo" value={prefijo} onChange={(e) => setPrefijo(e.target.value)} placeholder="opcional" className="cifra" />
            <Campo etiqueta="Desde" value={desde} onChange={(e) => setDesde(e.target.value)} className="cifra text-right" inputMode="numeric" />
            <Campo etiqueta="Hasta" value={hasta} onChange={(e) => setHasta(e.target.value)} className="cifra text-right" inputMode="numeric" />
          </div>
          <p className="text-xs text-apagado">
            Cargar un rango nuevo reemplaza el anterior. Hágalo cuando reciba un talonario nuevo de la imprenta.
          </p>
        </div>

        {error ? <Aviso>{error}</Aviso> : null}

        <div className="flex justify-end gap-2">
          <Boton variante="plano" onClick={onCerrar}>
            Cerrar
          </Boton>
          <Boton variante="principal" disabled={guardando || !desde || !hasta} onClick={() => void guardar()}>
            {guardando ? 'Guardando…' : 'Cargar talonario'}
          </Boton>
        </div>
      </div>
    </Modal>
  )
}
