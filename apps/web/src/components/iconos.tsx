import type { ReactNode } from 'react'

/**
 * Íconos de línea, inline y sin dependencias.
 *
 * Uno por sección de la navegación, más los pocos de uso general. Trazo de 1.75
 * para que se lean nítidos al tamaño pequeño de la barra lateral.
 */

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export const iconos: Record<string, ReactNode> = {
  // Venta: etiqueta de precio.
  venta: (
    <Svg>
      <path d="M3 9.5V5a2 2 0 0 1 2-2h4.5a2 2 0 0 1 1.4.6l8.5 8.5a2 2 0 0 1 0 2.8l-5.6 5.6a2 2 0 0 1-2.8 0L2.6 12A2 2 0 0 1 3 9.5Z" />
      <circle cx="7.5" cy="7.5" r="1.3" />
    </Svg>
  ),
  // Catálogo: caja de inventario.
  catalogo: (
    <Svg>
      <path d="M3 8 12 3l9 5v8l-9 5-9-5V8Z" />
      <path d="m3 8 9 5 9-5M12 13v8" />
    </Svg>
  ),
  // Clientes: personas.
  clientes: (
    <Svg>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="3.2" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.85M16 3.5A4 4 0 0 1 16 11" />
    </Svg>
  ),
  // Caja: registradora.
  caja: (
    <Svg>
      <rect x="3" y="8" width="18" height="12" rx="2" />
      <path d="M7 8V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v3M7 13h4M15 13h2" />
    </Svg>
  ),
  // Reportes: gráfico de barras.
  reportes: (
    <Svg>
      <path d="M3 3v17a1 1 0 0 0 1 1h17" />
      <rect x="7" y="12" width="3" height="5" rx="0.5" />
      <rect x="12.5" y="8" width="3" height="9" rx="0.5" />
      <rect x="18" y="5" width="3" height="12" rx="0.5" />
    </Svg>
  ),
  // Documentos: hoja con líneas.
  documentos: (
    <Svg>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </Svg>
  ),
  // Proveedores: camión.
  proveedores: (
    <Svg>
      <path d="M3 6a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v9H3Z" />
      <path d="M15 9h3.5a1 1 0 0 1 .8.4l2.5 3.3a1 1 0 0 1 .2.6V15h-7Z" />
      <circle cx="7" cy="18" r="2" />
      <circle cx="17" cy="18" r="2" />
    </Svg>
  ),
  // Plataforma: cuadrícula de negocios.
  plataforma: (
    <Svg>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </Svg>
  ),
  // Cobranza: billete.
  cobranza: (
    <Svg>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 12h.01M18 12h.01" />
    </Svg>
  ),
}

export function IconoMenu() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
      <path d="M3 6h18M3 12h18M3 18h18" />
    </svg>
  )
}

export function IconoSalir() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
    </svg>
  )
}
