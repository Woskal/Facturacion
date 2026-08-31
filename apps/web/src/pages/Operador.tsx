import { useCallback, useEffect, useState } from 'react'

import { ApiError, api } from '../api'
import { Aviso, Boton, Campo, Encabezado, Insignia, Modal, Select, Tarjeta, Vacio } from '../components/ui'

interface TenantJson {
  tenantId: string
  name: string
  rif: string
  userCount: number
  suspended: boolean
  createdAt: string
}

interface TenantUserJson {
  userId: string
  email: string
  fullName: string
}

/**
 * Panel de la plataforma.
 *
 * Que esta pantalla se vea depende de una bandera del servidor, pero eso solo
 * decide si se muestra: cada operación vuelve a comprobar contra la base quién
 * la pide. Lo que diga el navegador no autoriza nada.
 */
export function Operador() {
  const [negocios, setNegocios] = useState<TenantJson[]>([])
  const [error, setError] = useState<string | null>(null)
  const [creandoNegocio, setCreandoNegocio] = useState(false)
  const [creandoUsuario, setCreandoUsuario] = useState<TenantJson | null>(null)
  const [viendo, setViendo] = useState<TenantJson | null>(null)
  const [usuarios, setUsuarios] = useState<TenantUserJson[]>([])

  const cargar = useCallback(async () => {
    try {
      const data = await api.get<{ tenants: TenantJson[] }>('/platform/tenants')
      setNegocios(data.tenants)
      setError(null)
    } catch (fallo) {
      setError(fallo instanceof ApiError ? fallo.message : 'No se pudo cargar el panel.')
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  useEffect(() => {
    if (!viendo) {
      setUsuarios([])
      return
    }
    void api
      .get<{ users: TenantUserJson[] }>(`/platform/tenants/${viendo.tenantId}/users`)
      .then((data) => setUsuarios(data.users))
      .catch(() => setUsuarios([]))
  }, [viendo])

  async function alternarSuspension(negocio: TenantJson) {
    try {
      await api.post(
        `/platform/tenants/${negocio.tenantId}/${negocio.suspended ? 'reactivate' : 'suspend'}`,
      )
      await cargar()
    } catch (fallo) {
      setError(fallo instanceof ApiError ? fallo.message : 'No se pudo cambiar el estado.')
    }
  }

  return (
    <div className="mx-auto flex h-full max-w-4xl flex-col gap-4">
      <Encabezado titulo="Negocios de la plataforma" subtitulo={`${negocios.length} en total`}>
        <Boton variante="principal" onClick={() => setCreandoNegocio(true)}>
          Nuevo negocio
        </Boton>
      </Encabezado>

      {error ? <Aviso>{error}</Aviso> : null}

      <Tarjeta className="min-h-0 flex-1 overflow-auto">
        {negocios.length === 0 ? (
          <Vacio>Todavía no hay negocios dados de alta.</Vacio>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 border-b border-borde bg-lienzo text-xs uppercase tracking-wide text-apagado">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium">Negocio</th>
                <th className="w-24 px-2 py-2.5 text-center font-medium">Cuentas</th>
                <th className="w-28 px-2 py-2.5 text-center font-medium">Estado</th>
                <th className="w-72" />
              </tr>
            </thead>
            <tbody>
              {negocios.map((negocio) => (
                <tr key={negocio.tenantId} className="border-b border-borde/60 transition last:border-0 hover:bg-tenue/50">
                  <td className="px-4 py-2.5">
                    <span className="block font-medium text-tinta">{negocio.name}</span>
                    <span className="cifra block text-xs text-apagado">{negocio.rif}</span>
                  </td>
                  <td className="cifra px-2 py-2.5 text-center text-tinta">{negocio.userCount}</td>
                  <td className="px-2 py-2.5 text-center">
                    <Insignia tono={negocio.suspended ? 'error' : 'exito'}>
                      {negocio.suspended ? 'suspendido' : 'activo'}
                    </Insignia>
                  </td>
                  <td className="whitespace-nowrap px-2 py-2.5 text-right">
                    <div className="flex justify-end gap-1">
                      <Boton variante="plano" tamano="sm" onClick={() => setViendo(negocio)}>
                        Cuentas
                      </Boton>
                      <Boton variante="plano" tamano="sm" onClick={() => setCreandoUsuario(negocio)}>
                        Agregar
                      </Boton>
                      <Boton
                        variante={negocio.suspended ? 'plano' : 'peligro'}
                        tamano="sm"
                        onClick={() => void alternarSuspension(negocio)}
                      >
                        {negocio.suspended ? 'Reactivar' : 'Suspender'}
                      </Boton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Tarjeta>

      <p className="text-center text-xs text-apagado">
        Suspender corta el acceso al instante y cierra las sesiones abiertas, pero no borra nada.
      </p>

      {creandoNegocio ? (
        <NuevoNegocio
          onCerrar={() => setCreandoNegocio(false)}
          onCreado={() => {
            setCreandoNegocio(false)
            void cargar()
          }}
        />
      ) : null}

      {creandoUsuario ? (
        <NuevaCuenta
          negocio={creandoUsuario}
          onCerrar={() => setCreandoUsuario(null)}
          onCreada={() => {
            setCreandoUsuario(null)
            void cargar()
          }}
        />
      ) : null}

      {viendo ? (
        <Modal titulo="Cuentas del negocio" descripcion={viendo.name} onCerrar={() => setViendo(null)}>
          {usuarios.length === 0 ? (
            <Vacio>Este negocio no tiene cuentas asignadas.</Vacio>
          ) : (
            <ul className="space-y-1.5">
              {usuarios.map((usuario) => (
                <li key={usuario.userId} className="rounded-lg bg-tenue px-3 py-2 text-sm">
                  <span className="block font-medium text-tinta">{usuario.fullName}</span>
                  <span className="block text-xs text-apagado">{usuario.email}</span>
                </li>
              ))}
            </ul>
          )}
        </Modal>
      ) : null}
    </div>
  )
}

function NuevoNegocio({ onCerrar, onCreado }: { onCerrar: () => void; onCreado: () => void }) {
  const [name, setName] = useState('')
  const [rifKind, setRifKind] = useState<'V' | 'E' | 'J' | 'G' | 'P'>('J')
  const [rifNumber, setRifNumber] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function guardar() {
    setError(null)
    setEnviando(true)
    try {
      await api.post('/platform/tenants', {
        name: name.trim(),
        rifKind,
        rifNumber: rifNumber.trim(),
        ...(phone.trim() ? { phone: phone.trim() } : {}),
      })
      onCreado()
    } catch (fallo) {
      setError(fallo instanceof ApiError ? fallo.message : 'No se pudo crear el negocio.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Modal titulo="Nuevo negocio" onCerrar={onCerrar}>
      <div className="space-y-3">
        <Campo etiqueta="Nombre" value={name} onChange={(e) => setName(e.target.value)} autoFocus />

        <div className="grid grid-cols-[90px_1fr] gap-3">
          <Select etiqueta="Tipo" value={rifKind} onChange={(e) => setRifKind(e.target.value as typeof rifKind)}>
            {(['J', 'G', 'V', 'E', 'P'] as const).map((letra) => (
              <option key={letra} value={letra}>
                {letra}
              </option>
            ))}
          </Select>
          <Campo
            etiqueta="RIF"
            value={rifNumber}
            onChange={(e) => setRifNumber(e.target.value)}
            className="cifra"
          />
        </div>

        <Campo etiqueta="Teléfono" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="opcional" />

        <p className="rounded-lg bg-tenue px-3 py-2 text-xs text-apagado">
          El negocio queda listo para vender: alícuotas de IVA, lista de precios, caja y series de numeración.
          El catálogo lo carga el propio negocio.
        </p>

        {error ? <Aviso>{error}</Aviso> : null}

        <div className="flex justify-end gap-2 pt-2">
          <Boton variante="plano" onClick={onCerrar}>
            Cancelar
          </Boton>
          <Boton
            variante="principal"
            disabled={enviando || name.trim() === '' || rifNumber.trim() === ''}
            onClick={() => void guardar()}
          >
            {enviando ? 'Creando…' : 'Crear'}
          </Boton>
        </div>
      </div>
    </Modal>
  )
}

function NuevaCuenta({
  negocio,
  onCerrar,
  onCreada,
}: {
  negocio: TenantJson
  onCerrar: () => void
  onCreada: () => void
}) {
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function guardar() {
    setError(null)
    setEnviando(true)
    try {
      await api.post('/platform/users', {
        email: email.trim(),
        fullName: fullName.trim(),
        password,
        tenantId: negocio.tenantId,
      })
      onCreada()
    } catch (fallo) {
      setError(fallo instanceof ApiError ? fallo.message : 'No se pudo crear la cuenta.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Modal titulo="Nueva cuenta" descripcion={negocio.name} onCerrar={onCerrar}>
      <div className="space-y-3">
        <Campo etiqueta="Nombre" value={fullName} onChange={(e) => setFullName(e.target.value)} autoFocus />
        <Campo etiqueta="Correo" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Campo
          etiqueta="Contraseña"
          type="text"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          ayuda="Al menos 12 caracteres. Entrégueselo al dueño para que la cambie."
        />

        {error ? <Aviso>{error}</Aviso> : null}

        <div className="flex justify-end gap-2 pt-2">
          <Boton variante="plano" onClick={onCerrar}>
            Cancelar
          </Boton>
          <Boton
            variante="principal"
            disabled={enviando || fullName.trim() === '' || email.trim() === '' || password.length < 12}
            onClick={() => void guardar()}
          >
            {enviando ? 'Creando…' : 'Crear'}
          </Boton>
        </div>
      </div>
    </Modal>
  )
}
