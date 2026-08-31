import { useState } from 'react'
import { formatMoney, formatRate, rate as makeRate } from '@fve/money'

import { ApiError, api, toMoney, type FullDocumentJson, type MoneyJson } from '../api'
import { cantidad } from '../formato'
import { Aviso, Boton, Campo, Modal, Segmentado } from './ui'

/**
 * Documento imprimible.
 *
 * Es el entregable de un sistema de facturación: lo que el cliente se lleva. Se
 * arma en dos formatos —hoja carta para la factura sobre forma libre, y ticket
 * de 80 mm para el día a día en impresora térmica— a partir de lo que quedó
 * guardado con el documento. Nada se recalcula: una reimpresión del año que
 * viene sale idéntica a la que se entregó.
 */

const TITULOS: Record<FullDocumentJson['kind'], string> = {
  FACTURA: 'Factura',
  PRESUPUESTO: 'Presupuesto',
  NOTA_ENTREGA: 'Nota de entrega',
  RECIBO: 'Recibo',
  NOTA_CREDITO: 'Nota de crédito',
}

const METODOS: Record<string, string> = {
  EFECTIVO_BS: 'Efectivo Bs',
  EFECTIVO_USD: 'Efectivo divisa',
  PAGO_MOVIL: 'Pago móvil',
  TRANSFERENCIA_BS: 'Transferencia',
  PUNTO_VENTA: 'Punto de venta',
  ZELLE: 'Zelle',
  USDT: 'USDT',
  CREDITO: 'Crédito',
}

const m = (valor: MoneyJson) => formatMoney(toMoney(valor))
const pct = (bps: number) => `${(bps / 100).toLocaleString('es-VE')}%`

function fecha(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es-VE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Visor con controles: alterna formato, imprime y cierra. */
export function VisorDocumento({
  documento,
  onCerrar,
  onAnulado,
}: {
  documento: FullDocumentJson
  onCerrar: () => void
  /** Si va, se muestra el botón de anular; se llama tras anular con éxito. */
  onAnulado?: (() => void) | undefined
}) {
  const [formato, setFormato] = useState<'carta' | 'ticket'>(documento.kind === 'FACTURA' ? 'carta' : 'ticket')
  const [anulando, setAnulando] = useState(false)
  const [razon, setRazon] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const emitido = documento.status === 'ISSUED'

  async function anular() {
    setEnviando(true)
    setError(null)
    try {
      await api.post(`/sales/${documento.documentId}/void`, { reason: razon.trim() })
      setAnulando(false)
      onAnulado?.()
      onCerrar()
    } catch (fallo) {
      setError(fallo instanceof ApiError ? fallo.message : 'No se pudo anular el documento.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="atenuar fixed inset-0 z-40 flex flex-col bg-tinta/80">
      <div className="no-imprimir flex items-center justify-between gap-3 border-b border-borde bg-lienzo px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-tinta">
            {TITULOS[documento.kind]} {documento.fullNumber}
          </span>
          {documento.status === 'VOIDED' ? (
            <span className="rounded-full bg-error-tenue px-2 py-0.5 text-xs font-medium text-error">Anulado</span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Segmentado
            valor={formato}
            onCambio={setFormato}
            opciones={[
              { valor: 'carta', nombre: 'Carta' },
              { valor: 'ticket', nombre: 'Ticket' },
            ]}
          />
          {onAnulado && emitido ? (
            <Boton variante="peligro" onClick={() => setAnulando(true)}>
              Anular
            </Boton>
          ) : null}
          <Boton variante="principal" onClick={() => window.print()}>
            Imprimir
          </Boton>
          <Boton variante="plano" onClick={onCerrar}>
            Cerrar
          </Boton>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 sm:p-8">
        {formato === 'carta' ? <Carta d={documento} /> : <Ticket d={documento} />}
      </div>

      {anulando ? (
        <Modal
          titulo="Anular documento"
          descripcion={`${TITULOS[documento.kind]} ${documento.fullNumber}`}
          onCerrar={() => setAnulando(false)}
        >
          <div className="space-y-3">
            <p className="text-sm text-apagado">
              Anular conserva el documento y su número, pero lo deja en cero en el libro. No se borra y no se
              puede deshacer.
            </p>
            <Campo
              etiqueta="Motivo de la anulación"
              value={razon}
              onChange={(e) => setRazon(e.target.value)}
              placeholder="Error en la venta, devolución…"
              autoFocus
            />
            {error ? <Aviso>{error}</Aviso> : null}
            <div className="flex justify-end gap-2 pt-1">
              <Boton variante="plano" onClick={() => setAnulando(false)}>
                Cancelar
              </Boton>
              <Boton variante="peligro" disabled={enviando || razon.trim() === ''} onClick={() => void anular()}>
                {enviando ? 'Anulando…' : 'Anular documento'}
              </Boton>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}

/** Hoja carta para la factura sobre forma libre. */
function Carta({ d }: { d: FullDocumentJson }) {
  return (
    <div className="imprimible mx-auto w-[816px] max-w-full bg-white p-10 text-tinta shadow-realce">
      {/* Encabezado */}
      <div className="flex items-start justify-between gap-6 border-b border-borde pb-5">
        <div className="min-w-0">
          <h1 className="text-lg font-bold">{d.issuer.name}</h1>
          {d.issuer.legalName && d.issuer.legalName !== d.issuer.name ? (
            <p className="text-sm text-apagado">{d.issuer.legalName}</p>
          ) : null}
          <p className="cifra mt-1 text-sm font-medium">RIF: {d.issuer.rif}</p>
          <div className="mt-1 text-xs text-apagado">
            {d.issuer.address ? <p>{d.issuer.address}</p> : null}
            <p>
              {[d.issuer.city, d.issuer.phone, d.issuer.email, d.issuer.website].filter(Boolean).join(' · ')}
            </p>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="inline-block rounded-lg border border-borde px-4 py-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-apagado">{TITULOS[d.kind]}</p>
            <p className="cifra text-lg font-bold">{d.fullNumber}</p>
            {d.controlNumber ? (
              <p className="cifra text-xs text-apagado">N° de control {d.controlNumber}</p>
            ) : null}
          </div>
          <p className="cifra mt-2 text-xs text-apagado">{fecha(d.issuedAt)}</p>
        </div>
      </div>

      {/* Cliente */}
      <div className="flex items-start justify-between gap-6 border-b border-borde py-4 text-sm">
        <div>
          <span className="text-xs font-semibold uppercase tracking-wide text-apagado">Cliente</span>
          <p className="font-medium">{d.customer?.name ?? 'Consumidor final'}</p>
          {d.customer ? (
            <>
              <p className="cifra text-xs text-apagado">{d.customer.id}</p>
              {d.customer.address ? <p className="text-xs text-apagado">{d.customer.address}</p> : null}
              {d.customer.phone ? <p className="cifra text-xs text-apagado">{d.customer.phone}</p> : null}
            </>
          ) : null}
        </div>
        <div className="text-right text-xs text-apagado">
          <span className="font-semibold uppercase tracking-wide">Tasa</span>
          <p className="cifra">Bs {formatRate(makeRate(BigInt(d.rateBsPerUsd), d.rateDate))} / $</p>
          <p className="cifra">{d.rateDate}</p>
        </div>
      </div>

      {/* Líneas */}
      <table className="mt-4 w-full text-sm">
        <thead>
          <tr className="border-b border-borde text-left text-xs uppercase tracking-wide text-apagado">
            <th className="py-2 pr-2 font-medium">Descripción</th>
            <th className="w-20 px-2 py-2 text-right font-medium">Cant.</th>
            <th className="w-28 px-2 py-2 text-right font-medium">Precio</th>
            <th className="w-14 px-2 py-2 text-center font-medium">IVA</th>
            <th className="w-28 py-2 pl-2 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {d.lines.map((linea) => (
            <tr key={linea.lineNumber} className="border-b border-borde/60 align-top">
              <td className="py-2 pr-2">
                <span className="block">{linea.description}</span>
                {linea.sku ? <span className="cifra block text-xs text-apagado">{linea.sku}</span> : null}
              </td>
              <td className="cifra px-2 py-2 text-right">
                {cantidad(BigInt(linea.quantity))} {linea.unit}
              </td>
              <td className="cifra px-2 py-2 text-right">{m(linea.unitPrice)}</td>
              <td className="px-2 py-2 text-center text-xs text-apagado">{linea.taxCode}</td>
              <td className="cifra py-2 pl-2 text-right font-medium">{m(linea.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Totales */}
      <div className="mt-5 flex justify-end">
        <div className="w-72 space-y-1 text-sm">
          <Fila etiqueta="Subtotal" valor={m(d.totals.gross)} />
          {toMoney(d.totals.discount).amount > 0n ? (
            <Fila etiqueta="Descuento" valor={`− ${m(d.totals.discount)}`} />
          ) : null}
          {toMoney(d.totals.exempt).amount > 0n ? <Fila etiqueta="Exento" valor={m(d.totals.exempt)} /> : null}
          <Fila etiqueta="Base imponible" valor={m(d.totals.taxableBase)} />
          {d.taxes.map((t) => (
            <Fila key={t.taxCode} etiqueta={`IVA ${pct(t.baseBps + t.adicionalBps)}`} valor={m(t.iva)} />
          ))}
          {toMoney(d.totals.igtf).amount > 0n ? <Fila etiqueta="IGTF" valor={m(d.totals.igtf)} /> : null}
          <div className="mt-1 flex items-baseline justify-between border-t border-borde pt-2 text-base font-bold">
            <span>Total</span>
            <span className="cifra">{m(d.totals.grandTotal)}</span>
          </div>
          <div className="flex items-baseline justify-between text-xs text-apagado">
            <span>Equivalente</span>
            <span className="cifra">{m(d.totalOther)}</span>
          </div>
        </div>
      </div>

      {/* Pagos */}
      {d.payments.length > 0 ? (
        <div className="mt-5 border-t border-borde pt-3 text-xs text-apagado">
          <span className="font-semibold uppercase tracking-wide">Pagos</span>
          <div className="mt-1 flex flex-wrap gap-x-6 gap-y-1">
            {d.payments.map((p, i) => (
              <span key={i} className="cifra">
                {METODOS[p.method] ?? p.method}: {m(p.amount)}
                {p.reference ? ` (${p.reference})` : ''}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {/* Pie */}
      <div className="mt-6 border-t border-borde pt-4 text-center text-xs text-apagado">
        {d.issuer.footer ? <p className="mb-1 whitespace-pre-line">{d.issuer.footer}</p> : null}
        <p>Emitido por {d.issuedBy || '—'}</p>
        <p className="mt-1 italic">Este documento no es una factura fiscal emitida por máquina fiscal.</p>
      </div>
    </div>
  )
}

function Fila({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="flex items-baseline justify-between text-apagado">
      <span>{etiqueta}</span>
      <span className="cifra text-tinta">{valor}</span>
    </div>
  )
}

/** Ticket angosto para impresora térmica de 80 mm. */
function Ticket({ d }: { d: FullDocumentJson }) {
  return (
    <div className="imprimible ticket-80 mx-auto bg-white p-3 text-xs text-tinta shadow-realce">
      <div className="text-center">
        <p className="text-sm font-bold">{d.issuer.name}</p>
        <p className="cifra">RIF: {d.issuer.rif}</p>
        {d.issuer.address ? <p>{d.issuer.address}</p> : null}
        {d.issuer.phone ? <p className="cifra">{d.issuer.phone}</p> : null}
      </div>

      <div className="my-2 border-y border-dashed border-borde-fuerte py-1 text-center">
        <p className="font-semibold uppercase">{TITULOS[d.kind]}</p>
        <p className="cifra">{d.fullNumber}</p>
        {d.controlNumber ? <p className="cifra">Control {d.controlNumber}</p> : null}
        <p className="cifra">{fecha(d.issuedAt)}</p>
      </div>

      <p className="cifra">Cliente: {d.customer?.name ?? 'Consumidor final'}</p>
      {d.customer ? <p className="cifra">{d.customer.id}</p> : null}

      <div className="my-2 border-t border-dashed border-borde-fuerte pt-2">
        {d.lines.map((linea) => (
          <div key={linea.lineNumber} className="mb-1">
            <p>{linea.description}</p>
            <div className="cifra flex justify-between">
              <span>
                {cantidad(BigInt(linea.quantity))} × {m(linea.unitPrice)}
              </span>
              <span className="font-medium">{m(linea.total)}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-dashed border-borde-fuerte pt-2">
        {d.taxes.map((t) => (
          <div key={t.taxCode} className="cifra flex justify-between text-apagado">
            <span>IVA {pct(t.baseBps + t.adicionalBps)}</span>
            <span>{m(t.iva)}</span>
          </div>
        ))}
        {toMoney(d.totals.igtf).amount > 0n ? (
          <div className="cifra flex justify-between text-apagado">
            <span>IGTF</span>
            <span>{m(d.totals.igtf)}</span>
          </div>
        ) : null}
        <div className="cifra mt-1 flex justify-between text-sm font-bold">
          <span>TOTAL</span>
          <span>{m(d.totals.grandTotal)}</span>
        </div>
        <div className="cifra flex justify-between text-apagado">
          <span>Equiv.</span>
          <span>{m(d.totalOther)}</span>
        </div>
      </div>

      {d.payments.length > 0 ? (
        <div className="mt-2 border-t border-dashed border-borde-fuerte pt-2">
          {d.payments.map((p, i) => (
            <div key={i} className="cifra flex justify-between">
              <span>{METODOS[p.method] ?? p.method}</span>
              <span>{m(p.amount)}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="mt-3 text-center">
        {d.issuer.footer ? <p className="mb-1 whitespace-pre-line">{d.issuer.footer}</p> : null}
        <p>¡Gracias por su compra!</p>
      </div>
    </div>
  )
}
