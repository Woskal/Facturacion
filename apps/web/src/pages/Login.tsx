import { useState, type FormEvent } from 'react'

import { ApiError, api, setToken, type LoginResponse } from '../api'
import { Aviso, Boton, Campo, Tarjeta } from '../components/ui'

export function Login({ onEntrar }: { onEntrar: (sesion: LoginResponse) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function enviar(evento: FormEvent) {
    evento.preventDefault()
    setError(null)
    setEnviando(true)

    try {
      const sesion = await api.post<LoginResponse>('/auth/login', { email, password })
      setToken(sesion.token)
      onEntrar(sesion)
    } catch (fallo) {
      // El servidor devuelve el mismo mensaje para correo inexistente y clave
      // incorrecta, a propósito. Aquí no se adorna.
      setError(fallo instanceof ApiError ? fallo.message : 'No se pudo conectar con el servidor.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <Tarjeta className="w-full max-w-sm p-6">
        <h1 className="text-xl font-semibold">Entrar</h1>
        <p className="mt-1 text-sm text-apagado">Punto de venta y gestión</p>

        <form onSubmit={enviar} className="mt-6 space-y-4">
          <Campo
            etiqueta="Correo"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            autoFocus
            required
          />
          <Campo
            etiqueta="Contraseña"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />

          {error ? <Aviso>{error}</Aviso> : null}

          <Boton type="submit" variante="principal" className="w-full" disabled={enviando}>
            {enviando ? 'Entrando…' : 'Entrar'}
          </Boton>
        </form>
      </Tarjeta>
    </div>
  )
}
