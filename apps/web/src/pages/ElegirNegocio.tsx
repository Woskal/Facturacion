import { useState } from 'react'

import { ApiError, api, type Membership } from '../api'
import { Aviso, Boton, Tarjeta, Vacio } from '../components/ui'

/**
 * Selección de negocio.
 *
 * La sesión nace sin negocio activo aunque solo haya uno: elegirlo es un paso
 * explícito del servidor, y esta pantalla lo refleja. Con un solo negocio se
 * entra de una vez para no estorbar.
 */
export function ElegirNegocio({
  memberships,
  onElegido,
  onSalir,
}: {
  memberships: Membership[]
  onElegido: (tenantId: string, nombre: string) => void
  onSalir: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)

  async function elegir(membership: Membership) {
    setError(null)
    setOcupado(membership.tenantId)

    try {
      await api.post('/auth/select-tenant', { tenantId: membership.tenantId })
      onElegido(membership.tenantId, membership.tenantName)
    } catch (fallo) {
      setError(fallo instanceof ApiError ? fallo.message : 'No se pudo abrir el negocio.')
      setOcupado(null)
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-papel p-6">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-semibold text-tinta">Elija el negocio</h1>
          <p className="mt-1 text-sm text-apagado">Su cuenta tiene acceso a más de uno</p>
        </div>

        <Tarjeta className="p-3">
          {memberships.length === 0 ? (
            <Vacio>
              Su cuenta todavía no está asignada a ningún negocio. Pida al administrador de la plataforma que
              lo agregue.
            </Vacio>
          ) : (
            <ul className="space-y-1.5">
              {memberships.map((membership) => (
                <li key={membership.tenantId}>
                  <button
                    onClick={() => void elegir(membership)}
                    disabled={ocupado !== null}
                    className="group flex w-full items-center justify-between gap-3 rounded-lg border border-transparent px-4 py-3 text-left transition hover:border-borde hover:bg-tenue disabled:opacity-50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-tinta">{membership.tenantName}</span>
                      <span className="block text-xs text-apagado">
                        {ocupado === membership.tenantId ? 'Abriendo…' : 'Abrir negocio'}
                      </span>
                    </span>
                    <span className="text-tenue-tinta transition group-hover:text-acento">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9 18l6-6-6-6" />
                      </svg>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Tarjeta>

        {error ? <div className="mt-4">{<Aviso>{error}</Aviso>}</div> : null}

        <Boton variante="plano" className="mt-6 w-full" onClick={onSalir}>
          Salir
        </Boton>
      </div>
    </div>
  )
}
