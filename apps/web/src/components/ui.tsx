import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from 'react'

/**
 * Piezas de interfaz compartidas.
 *
 * Poca cosa y explícita, sin biblioteca de componentes detrás. Todo se apoya en
 * los mismos tokens de color, radio y sombra de `index.css`, así que la interfaz
 * entera se ve de una pieza y cambiar el sistema es cambiar un archivo.
 */

const TAMANOS = {
  sm: 'h-8 px-3 text-sm gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-11 px-5 text-base gap-2',
  xl: 'h-14 px-6 text-base gap-2', // objetivo táctil grande, p. ej. el botón de cobrar
} as const

export function Boton({
  variante = 'normal',
  tamano = 'md',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variante?: 'normal' | 'principal' | 'peligro' | 'plano' | 'suave' | undefined
  tamano?: keyof typeof TAMANOS | undefined
}) {
  const estilos = {
    normal: 'bg-lienzo border-borde text-tinta shadow-suave hover:bg-tenue hover:border-borde-fuerte',
    principal: 'bg-acento border-acento text-white shadow-suave hover:bg-acento-fuerte hover:border-acento-fuerte',
    suave: 'bg-acento-tenue border-transparent text-acento hover:bg-acento/15',
    peligro: 'bg-lienzo border-borde text-error shadow-suave hover:bg-error-tenue hover:border-error/40',
    plano: 'bg-transparent border-transparent text-apagado hover:text-tinta hover:bg-tenue',
  }[variante]

  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center rounded-lg border font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-acento/30 focus-visible:ring-offset-1 focus-visible:ring-offset-papel disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none ${TAMANOS[tamano]} ${estilos} ${className}`}
    />
  )
}

export function Campo({
  etiqueta,
  ayuda,
  error,
  className = '',
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  etiqueta?: string | undefined
  ayuda?: string | undefined
  error?: string | undefined
}) {
  return (
    <label className="block">
      {etiqueta ? <span className="mb-1.5 block text-sm font-medium text-tinta">{etiqueta}</span> : null}
      <input
        {...props}
        className={`h-10 w-full rounded-lg border bg-lienzo px-3 text-sm text-tinta outline-none transition placeholder:text-apagado/60 focus:ring-2 focus:ring-acento/20 ${
          error ? 'border-error focus:border-error' : 'border-borde focus:border-acento'
        } ${className}`}
      />
      {error ? <span className="mt-1 block text-xs text-error">{error}</span> : null}
      {!error && ayuda ? <span className="mt-1 block text-xs text-apagado">{ayuda}</span> : null}
    </label>
  )
}

export function Select({
  etiqueta,
  className = '',
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { etiqueta?: string | undefined }) {
  return (
    <label className="block">
      {etiqueta ? <span className="mb-1.5 block text-sm font-medium text-tinta">{etiqueta}</span> : null}
      <select
        {...props}
        className={`h-10 w-full rounded-lg border border-borde bg-lienzo px-3 text-sm text-tinta outline-none transition focus:border-acento focus:ring-2 focus:ring-acento/20 ${className}`}
      >
        {children}
      </select>
    </label>
  )
}

export function Tarjeta({
  children,
  className = '',
  plano = false,
}: {
  children: ReactNode
  className?: string | undefined
  /** Sin sombra, solo borde. Para tarjetas dentro de otra superficie. */
  plano?: boolean | undefined
}) {
  return (
    <div
      className={`rounded-xl border border-borde bg-lienzo ${plano ? '' : 'shadow-suave'} ${className}`}
    >
      {children}
    </div>
  )
}

/** Cabecera de sección dentro de una tarjeta o columna. */
export function CabeceraTarjeta({
  children,
  accion,
}: {
  children: ReactNode
  accion?: ReactNode
}) {
  return (
    <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-borde bg-lienzo/95 px-4 py-2.5 backdrop-blur">
      <span className="text-xs font-semibold uppercase tracking-wide text-apagado">{children}</span>
      {accion}
    </div>
  )
}

export function Aviso({
  tipo = 'error',
  children,
}: {
  tipo?: 'error' | 'alerta' | 'exito' | 'info' | undefined
  children: ReactNode
}) {
  const estilos = {
    error: 'border-error/25 bg-error-tenue text-error',
    alerta: 'border-alerta/30 bg-alerta-tenue text-alerta',
    exito: 'border-exito/25 bg-exito-tenue text-exito',
    info: 'border-acento/20 bg-acento-tenue text-acento',
  }[tipo]

  return <div className={`rounded-lg border px-3.5 py-2.5 text-sm ${estilos}`}>{children}</div>
}

export function Insignia({
  tono = 'neutro',
  children,
}: {
  tono?: 'neutro' | 'acento' | 'exito' | 'alerta' | 'error' | undefined
  children: ReactNode
}) {
  const estilos = {
    neutro: 'bg-tenue text-apagado',
    acento: 'bg-acento-tenue text-acento',
    exito: 'bg-exito-tenue text-exito',
    alerta: 'bg-alerta-tenue text-alerta',
    error: 'bg-error-tenue text-error',
  }[tono]

  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${estilos}`}>
      {children}
    </span>
  )
}

/** Control segmentado: pocas opciones excluyentes, todas a la vista. */
export function Segmentado<T extends string>({
  valor,
  opciones,
  onCambio,
  className = '',
}: {
  valor: T
  opciones: readonly { valor: T; nombre: ReactNode }[]
  onCambio: (valor: T) => void
  className?: string | undefined
}) {
  return (
    <div className={`inline-flex gap-1 rounded-lg border border-borde bg-tenue p-1 ${className}`}>
      {opciones.map((opcion) => (
        <button
          key={opcion.valor}
          type="button"
          onClick={() => onCambio(opcion.valor)}
          className={`rounded-md px-3 py-1 text-sm font-medium transition ${
            valor === opcion.valor
              ? 'bg-lienzo text-tinta shadow-suave'
              : 'text-apagado hover:text-tinta'
          }`}
        >
          {opcion.nombre}
        </button>
      ))}
    </div>
  )
}

export function Vacio({ children }: { children: ReactNode }) {
  return <p className="px-4 py-12 text-center text-sm text-apagado">{children}</p>
}

/**
 * Encabezado de página: título, subtítulo opcional y una zona de acciones a la
 * derecha que baja debajo en pantallas angostas.
 */
export function Encabezado({
  titulo,
  subtitulo,
  children,
}: {
  titulo: string
  subtitulo?: string | undefined
  children?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold text-tinta">{titulo}</h1>
        {subtitulo ? <p className="mt-0.5 text-sm text-apagado">{subtitulo}</p> : null}
      </div>
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </div>
  )
}

/**
 * Diálogo modal.
 *
 * En una pantalla ancha se centra; en un teléfono sube desde abajo como una hoja
 * —el pulgar la alcanza y el gesto es el que la gente ya conoce—.
 */
export function Modal({
  titulo,
  descripcion,
  children,
  onCerrar,
  ancho = 'md',
}: {
  titulo: string
  descripcion?: string | undefined
  children: ReactNode
  onCerrar?: (() => void) | undefined
  ancho?: 'sm' | 'md' | 'lg' | undefined
}) {
  const anchos = { sm: 'sm:max-w-sm', md: 'sm:max-w-md', lg: 'sm:max-w-2xl' }[ancho]

  return (
    <div
      className="atenuar fixed inset-0 z-40 flex items-end justify-center bg-tinta/40 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCerrar?.()
      }}
    >
      <div
        className={`surgir max-h-[92vh] w-full overflow-y-auto rounded-t-2xl border border-borde bg-lienzo shadow-flotante sm:rounded-2xl ${anchos}`}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-start justify-between gap-4 border-b border-borde px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-tinta">{titulo}</h2>
            {descripcion ? <p className="mt-0.5 text-sm text-apagado">{descripcion}</p> : null}
          </div>
          {onCerrar ? (
            <button
              onClick={onCerrar}
              aria-label="Cerrar"
              className="-mr-1 -mt-1 shrink-0 rounded-lg p-1.5 text-apagado transition hover:bg-tenue hover:text-tinta"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          ) : null}
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}
