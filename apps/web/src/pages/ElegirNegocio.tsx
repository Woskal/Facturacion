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
    <div className="flex min-h-full items-center justify-center p-6">
      <Tarjeta className="w-full max-w-md p-6">
        <h1 className="text-xl font-semibold">Elija el negocio</h1>

        {memberships.length === 0 ? (
          <Vacio>
            Su cuenta todavía no está asignada a ningún negocio. Pida al administrador de la plataforma que
            lo agregue.
          </Vacio>
        ) : (
          <ul className="mt-5 space-y-2">
            {memberships.map((membership) => (
              <li key={membership.tenantId}>
                <button
                  onClick={() => void elegir(membership)}
                  disabled={ocupado !== null}
                  className="w-full rounded-lg border border-borde bg-white px-4 py-3 text-left transition hover:border-acento disabled:opacity-50"
                >
                  <span className="block font-medium">{membership.tenantName}</span>
                  <span className="block text-xs text-apagado">
                    {ocupado === membership.tenantId ? 'Abriendo…' : 'Abrir'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {error ? <div className="mt-4">{<Aviso>{error}</Aviso>}</div> : null}

        <Boton variante="plano" className="mt-6 w-full" onClick={onSalir}>
          Salir
        </Boton>
      </Tarjeta>
    </div>
  )
}
