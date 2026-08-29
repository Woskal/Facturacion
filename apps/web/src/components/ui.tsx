import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'

/** Piezas de interfaz compartidas. Poca cosa y explícita, sin biblioteca detrás. */

export function Boton({
  variante = 'normal',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: 'normal' | 'principal' | 'peligro' | 'plano' }) {
  const estilos = {
    normal: 'bg-white border-borde hover:bg-papel text-tinta',
    principal: 'bg-acento border-acento text-white hover:opacity-90',
    peligro: 'bg-white border-error text-error hover:bg-error/5',
    plano: 'bg-transparent border-transparent text-apagado hover:text-tinta hover:bg-borde/40',
  }[variante]

  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${estilos} ${className}`}
    />
  )
}

export function Campo({
  etiqueta,
  ayuda,
  error,
  className = '',
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { etiqueta?: string; ayuda?: string; error?: string }) {
  return (
    <label className="block">
      {etiqueta ? <span className="mb-1 block text-sm font-medium text-tinta">{etiqueta}</span> : null}
      <input
        {...props}
        className={`w-full rounded-lg border bg-white px-3 py-2 text-sm outline-none transition placeholder:text-apagado/60 focus:border-acento focus:ring-2 focus:ring-acento/20 ${
          error ? 'border-error' : 'border-borde'
        } ${className}`}
      />
      {error ? <span className="mt-1 block text-xs text-error">{error}</span> : null}
      {!error && ayuda ? <span className="mt-1 block text-xs text-apagado">{ayuda}</span> : null}
    </label>
  )
}

export function Tarjeta({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-borde bg-white ${className}`}>{children}</div>
}

export function Aviso({ tipo = 'error', children }: { tipo?: 'error' | 'alerta' | 'exito'; children: ReactNode }) {
  const estilos = {
    error: 'border-error/30 bg-error/5 text-error',
    alerta: 'border-alerta/30 bg-alerta/5 text-alerta',
    exito: 'border-exito/30 bg-exito/5 text-exito',
  }[tipo]

  return <div className={`rounded-lg border px-3 py-2 text-sm ${estilos}`}>{children}</div>
}

export function Vacio({ children }: { children: ReactNode }) {
  return <p className="px-4 py-10 text-center text-sm text-apagado">{children}</p>
}
