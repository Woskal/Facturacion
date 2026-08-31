import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'

import './index.css'
import {
  Aviso,
  Boton,
  Campo,
  CabeceraTarjeta,
  Insignia,
  Modal,
  Segmentado,
  Select,
  Tarjeta,
  Vacio,
} from './components/ui'
import { IconoMenu, IconoSalir, iconos } from './components/iconos'
import { VisorDocumento } from './components/DocumentoImprimible'
import type { FullDocumentJson } from './api'

const DOC_DEMO: FullDocumentJson = {
  documentId: 'demo',
  kind: 'FACTURA',
  fullNumber: 'F-000128',
  controlNumber: '00-00021547',
  status: 'ISSUED',
  issuedAt: '2026-08-31T14:32:00.000Z',
  voidReason: null,
  currency: 'VES',
  rateBsPerUsd: '8400000000',
  rateDate: '2026-08-31',
  issuer: {
    name: 'Bodegón La Esquina',
    legalName: 'Inversiones La Esquina, C.A.',
    rif: 'J-40551234-5',
    address: 'Av. Bolívar, local 3, Maracay',
    city: 'Maracay, Aragua',
    phone: '0243-555-1234',
    email: 'ventas@laesquina.ve',
    website: null,
    footer: 'Gracias por su compra. No se aceptan devoluciones sin este documento.',
  },
  customer: {
    name: 'Ferretería El Tornillo, C.A.',
    id: 'J-41220987-6',
    address: 'Calle 5, Zona Industrial San Vicente',
    phone: '0412-999-8877',
  },
  lines: [
    { lineNumber: 1, sku: 'HAR-001', description: 'Harina de maíz P.A.N. 1kg', unit: 'und', quantity: '10000', unitPrice: { currency: 'VES', amount: '8400' }, discountBps: 0, taxCode: 'G', total: { currency: 'VES', amount: '84000' } },
    { lineNumber: 2, sku: 'ACE-500', description: 'Aceite de girasol Vatel 1L', unit: 'und', quantity: '3000', unitPrice: { currency: 'VES', amount: '21000' }, discountBps: 0, taxCode: 'G', total: { currency: 'VES', amount: '63000' } },
  ],
  taxes: [{ taxCode: 'G', baseBps: 1600, adicionalBps: 0, base: { currency: 'VES', amount: '147000' }, iva: { currency: 'VES', amount: '23520' } }],
  payments: [{ method: 'PAGO_MOVIL', amount: { currency: 'VES', amount: '170520' }, reference: '0102-88431' }],
  totals: {
    gross: { currency: 'VES', amount: '147000' },
    discount: { currency: 'VES', amount: '0' },
    taxableBase: { currency: 'VES', amount: '147000' },
    exempt: { currency: 'VES', amount: '0' },
    iva: { currency: 'VES', amount: '23520' },
    igtf: { currency: 'VES', amount: '0' },
    total: { currency: 'VES', amount: '170520' },
    grandTotal: { currency: 'VES', amount: '170520' },
  },
  totalOther: { currency: 'USD', amount: '2030' },
  notes: null,
  issuedBy: 'María González',
}

/**
 * Harness de previsualización. No forma parte de la aplicación: existe solo para
 * ver el sistema de diseño y el marco responsive sin necesidad de la API. Se
 * puede borrar (este archivo y preview.html) sin afectar nada.
 */

const SECCIONES = [
  { clave: 'venta', nombre: 'Venta' },
  { clave: 'documentos', nombre: 'Documentos' },
  { clave: 'catalogo', nombre: 'Catálogo' },
  { clave: 'clientes', nombre: 'Clientes' },
  { clave: 'proveedores', nombre: 'Proveedores' },
  { clave: 'caja', nombre: 'Caja' },
  { clave: 'reportes', nombre: 'Reportes' },
  { clave: 'plataforma', nombre: 'Plataforma' },
  { clave: 'cobranza', nombre: 'Cobranza' },
] as const

const PRODUCTOS = [
  { sku: 'HAR-001', nombre: 'Harina de maíz P.A.N. 1kg', bs: '84,00', usd: '1,00', existencia: 240 },
  { sku: 'ACE-500', nombre: 'Aceite de girasol Vatel 1L', bs: '210,00', usd: '2,50', existencia: 58 },
  { sku: 'CAF-250', nombre: 'Café Fama de América 250g', bs: '168,00', usd: '2,00', existencia: 12 },
  { sku: 'AZU-001', nombre: 'Azúcar refinada Montalbán 1kg', bs: '100,80', usd: '1,20', existencia: 0 },
]

function App() {
  const [seccion, setSeccion] = useState('reportes')
  const [menuAbierto, setMenuAbierto] = useState(false)
  const [modal, setModal] = useState(false)
  const [verDoc, setVerDoc] = useState(false)
  const [rango, setRango] = useState<'hoy' | 'semana' | 'mes'>('semana')
  const activa = SECCIONES.find((s) => s.clave === seccion)

  const navegar = (clave: string) => {
    setSeccion(clave)
    setMenuAbierto(false)
  }

  const listaNav = (
    <nav className="flex flex-col gap-0.5">
      {SECCIONES.map((s) => {
        const sel = seccion === s.clave
        return (
          <button
            key={s.clave}
            onClick={() => navegar(s.clave)}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
              sel ? 'bg-acento text-white shadow-suave' : 'text-marca-apagado hover:bg-marca-alta hover:text-marca-texto'
            }`}
          >
            <span className={sel ? 'text-white' : 'text-marca-apagado'}>{iconos[s.clave]}</span>
            {s.nombre}
          </button>
        )
      })}
    </nav>
  )

  const cabecera = (
    <div className="min-w-0">
      <span className="block truncate text-sm font-semibold text-marca-texto">Bodegón La Esquina</span>
      <span className="cifra flex items-center gap-1.5 truncate text-xs text-marca-apagado">
        <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-exito"></span>
        Bs 84,00 por dólar · BCV
      </span>
    </div>
  )

  const salir = (
    <button className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-marca-apagado transition hover:bg-marca-alta hover:text-marca-texto">
      <IconoSalir />
      Salir
    </button>
  )

  return (
    <div className="flex h-full bg-papel">
      <aside className="hidden w-64 shrink-0 flex-col bg-marca lg:flex">
        <div className="border-b border-marca-borde px-5 py-4">{cabecera}</div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">{listaNav}</div>
        <div className="border-t border-marca-borde p-3">{salir}</div>
      </aside>

      {menuAbierto ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="atenuar absolute inset-0 bg-tinta/50" onClick={() => setMenuAbierto(false)} />
          <aside className="surgir absolute inset-y-0 left-0 flex w-72 max-w-[82%] flex-col bg-marca">
            <div className="flex items-center justify-between gap-3 border-b border-marca-borde px-5 py-4">{cabecera}</div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">{listaNav}</div>
            <div className="border-t border-marca-borde p-3">{salir}</div>
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-borde bg-marca px-4 py-2.5 lg:hidden">
          <button onClick={() => setMenuAbierto(true)} className="-ml-1 rounded-lg p-1.5 text-tinta hover:bg-tenue">
            <IconoMenu />
          </button>
          <div className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-tinta">{activa?.nombre}</span>
            <span className="cifra block truncate text-xs text-apagado">Bodegón La Esquina</span>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto p-4 lg:p-6">
          <div className="mx-auto max-w-5xl space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-lg font-semibold text-tinta">Reportes</h1>
                <p className="text-sm text-apagado">Ventas y ganancias del período</p>
              </div>
              <div className="flex items-center gap-2">
                <Boton variante="normal" onClick={() => setVerDoc(true)}>
                  Ver factura de ejemplo
                </Boton>
                <Segmentado
                  valor={rango}
                  onCambio={setRango}
                  opciones={[
                    { valor: 'hoy', nombre: 'Hoy' },
                    { valor: 'semana', nombre: 'Semana' },
                    { valor: 'mes', nombre: 'Mes' },
                  ]}
                />
              </div>
            </div>

            {/* Tarjetas de indicadores. */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {[
                { t: 'Ventas', v: 'Bs 48.320,00', s: '$ 575,24', tono: 'acento' as const },
                { t: 'Ganancia', v: 'Bs 12.180,00', s: '25,2% margen', tono: 'exito' as const },
                { t: 'Documentos', v: '134', s: '18 facturas', tono: 'neutro' as const },
                { t: 'Por cobrar', v: 'Bs 6.540,00', s: '7 clientes', tono: 'alerta' as const },
              ].map((k) => (
                <Tarjeta key={k.t} className="p-4">
                  <span className="text-xs font-medium uppercase tracking-wide text-apagado">{k.t}</span>
                  <div className="cifra mt-2 text-xl font-semibold text-tinta">{k.v}</div>
                  <div className="mt-1">
                    <Insignia tono={k.tono}>{k.s}</Insignia>
                  </div>
                </Tarjeta>
              ))}
            </div>

            {/* Tabla de productos. */}
            <Tarjeta className="overflow-hidden">
              <CabeceraTarjeta accion={<Boton tamano="sm" variante="principal" onClick={() => setModal(true)}>Nuevo producto</Boton>}>
                Catálogo
              </CabeceraTarjeta>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-borde text-left text-xs uppercase tracking-wide text-apagado">
                      <th className="px-4 py-2 font-medium">Producto</th>
                      <th className="px-4 py-2 text-right font-medium">Bs</th>
                      <th className="px-4 py-2 text-right font-medium">USD</th>
                      <th className="px-4 py-2 text-right font-medium">Existencia</th>
                    </tr>
                  </thead>
                  <tbody>
                    {PRODUCTOS.map((p) => (
                      <tr key={p.sku} className="border-b border-borde/60 last:border-0 hover:bg-tenue/50">
                        <td className="px-4 py-2.5">
                          <span className="block font-medium text-tinta">{p.nombre}</span>
                          <span className="cifra block text-xs text-apagado">{p.sku}</span>
                        </td>
                        <td className="cifra px-4 py-2.5 text-right font-medium">{p.bs}</td>
                        <td className="cifra px-4 py-2.5 text-right text-apagado">{p.usd}</td>
                        <td className="px-4 py-2.5 text-right">
                          {p.existencia === 0 ? (
                            <Insignia tono="error">Agotado</Insignia>
                          ) : p.existencia < 20 ? (
                            <Insignia tono="alerta">{p.existencia}</Insignia>
                          ) : (
                            <span className="cifra text-apagado">{p.existencia}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Tarjeta>

            {/* Botones y avisos de muestra. */}
            <div className="grid gap-4 lg:grid-cols-2">
              <Tarjeta className="space-y-3 p-4">
                <CabeceraTarjeta>Botones</CabeceraTarjeta>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Boton variante="principal">Principal</Boton>
                  <Boton variante="normal">Normal</Boton>
                  <Boton variante="suave">Suave</Boton>
                  <Boton variante="peligro">Anular</Boton>
                  <Boton variante="plano">Plano</Boton>
                </div>
              </Tarjeta>
              <Tarjeta className="space-y-2 p-4">
                <CabeceraTarjeta>Avisos</CabeceraTarjeta>
                <div className="space-y-2 pt-1">
                  <Aviso tipo="exito">Venta emitida. Documento F-000128.</Aviso>
                  <Aviso tipo="alerta">Quedan 5 números en el talonario de facturas.</Aviso>
                  <Aviso tipo="error">No se pudo obtener la tasa del día.</Aviso>
                </div>
              </Tarjeta>
            </div>
          </div>
        </main>
      </div>

      {modal ? (
        <Modal titulo="Nuevo producto" descripcion="El precio se ancla en dólares." onCerrar={() => setModal(false)}>
          <div className="space-y-3">
            <Campo etiqueta="Nombre" placeholder="Harina de maíz 1kg" autoFocus />
            <div className="grid grid-cols-2 gap-3">
              <Campo etiqueta="Precio USD" className="cifra text-right" placeholder="1,00" />
              <Select etiqueta="Alícuota">
                <option>IVA 16%</option>
                <option>Exento</option>
                <option>Reducida 8%</option>
              </Select>
            </div>
            <Vacio>Vista de ejemplo — sin datos reales.</Vacio>
            <div className="flex justify-end gap-2 pt-1">
              <Boton variante="plano" onClick={() => setModal(false)}>Cancelar</Boton>
              <Boton variante="principal">Crear</Boton>
            </div>
          </div>
        </Modal>
      ) : null}

      {verDoc ? <VisorDocumento documento={DOC_DEMO} onCerrar={() => setVerDoc(false)} /> : null}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
