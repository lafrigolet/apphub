import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import * as auth from '../lib/auth.js'
import { isAdminRole } from '../lib/auth.js'

// Página /activate?token=... — landing del magic-link de bootstrap.
// El owner llega con un token de un solo uso (sha256 del valor en BD)
// y aquí fija su contraseña. Tras el activate exitoso el backend
// devuelve un par access/refresh y publica `tenant.activated`; el
// portal redirige a /consola para que entre directamente al panel
// "Configura tu cuenta".
export default function ActivateView({ onLoggedIn }) {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const token = params.get('token') ?? ''

  const [password, setPassword]   = useState('')
  const [confirm, setConfirm]     = useState('')
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState(null)
  const [missingToken, setMissingToken] = useState(false)

  useEffect(() => {
    if (!token) setMissingToken(true)
  }, [token])

  async function onSubmit(e) {
    e.preventDefault()
    setError(null)
    if (password.length < 8)        return setError('La contraseña debe tener al menos 8 caracteres.')
    if (password !== confirm)       return setError('Las contraseñas no coinciden.')
    setLoading(true)
    try {
      const data = await auth.activate({ token, password })
      // Notifica al App.jsx para que actualice identity en context.
      onLoggedIn?.(data)
      // El owner siempre va a /consola (rol owner es admin-role).
      const target = isAdminRole(data.role) ? '/consola?bootstrap=welcome' : '/area-socio'
      navigate(target, { replace: true })
    } catch (err) {
      setError(err.message ?? 'No se pudo activar la cuenta.')
    } finally {
      setLoading(false)
    }
  }

  if (missingToken) {
    return (
      <div className="activate-shell">
        <div className="activate-card">
          <h1>Enlace no válido</h1>
          <p>Esta URL no contiene un token de activación. Vuelve a abrir el enlace
            que recibiste por email, o pide al equipo de plataforma que te reenvíe uno.</p>
          <a className="activate-btn ghost" href="/">Volver al inicio</a>
        </div>
      </div>
    )
  }

  return (
    <div className="activate-shell">
      <div className="activate-card">
        <div className="activate-eyebrow">Activación</div>
        <h1>Bienvenido</h1>
        <p>
          Estás a un paso de activar tu cuenta. Elige una contraseña para empezar
          a usar tu workspace.
        </p>

        <form onSubmit={onSubmit} className="activate-form">
          <label className="activate-field">
            <span>Contraseña</span>
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
              autoFocus
            />
          </label>
          <label className="activate-field">
            <span>Repite la contraseña</span>
            <input
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              minLength={8}
              required
            />
          </label>

          {error && <div className="activate-error">{error}</div>}

          <button type="submit" className="activate-btn primary" disabled={loading}>
            {loading ? 'Activando…' : 'Activar mi cuenta'}
          </button>
        </form>

        <div className="activate-hint">
          ¿Problemas con el enlace? Pide al equipo de plataforma que te reenvíe el
          email — los enlaces caducan a los 7 días y sólo pueden usarse una vez.
        </div>
      </div>
    </div>
  )
}
