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
    <div className="flex min-h-full items-center justify-center bg-papel p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-acento text-white shadow-realce">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
              <path d="M14 3v5h5M9 13h6M9 17h4" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-tinta">Punto de venta y gestión</h1>
          <p className="mt-1 text-sm text-apagado">Entre a su negocio para continuar</p>
        </div>

        <Tarjeta className="p-6">
          <form onSubmit={enviar} className="space-y-4">
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

            <Boton type="submit" variante="principal" tamano="lg" className="w-full" disabled={enviando}>
              {enviando ? 'Entrando…' : 'Entrar'}
            </Boton>
          </form>
        </Tarjeta>

        <p className="mt-6 text-center text-xs text-apagado">
          Manejo bimonetario Bs / USD · Tasa del BCV al día
        </p>
      </div>
    </div>
  )
}
