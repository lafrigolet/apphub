import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import * as auth from '../lib/auth.js'

// Página /reset-password?token=... — landing del magic-link de
// "olvidé mi contraseña". A diferencia de /activate (bootstrap de owner
// que devuelve sesión y entra directo a /consola), aquí el backend
// SÓLO confirma el cambio de contraseña. Tras éxito mostramos un panel
// de "Listo" con botón para volver al portal e iniciar sesión.
export default function ResetPasswordView({ onLoginOpen }) {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const token = params.get('token') ?? ''

  const [password, setPassword] = useState('')
  const [confirm, setConfirm]   = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState(null)
  const [done, setDone]         = useState(false)
  const [missingToken, setMissingToken] = useState(false)

  useEffect(() => {
    if (!token) setMissingToken(true)
  }, [token])

  async function onSubmit(e) {
    e.preventDefault()
    setError(null)
    if (password.length < 8)  return setError('La contraseña debe tener al menos 8 caracteres.')
    if (password !== confirm) return setError('Las contraseñas no coinciden.')
    setLoading(true)
    try {
      await auth.resetPassword({ token, newPassword: password })
      setDone(true)
    } catch (err) {
      // Casos típicos: token caducado, token ya usado, token inválido.
      setError(err.message ?? 'No se pudo restablecer la contraseña.')
    } finally {
      setLoading(false)
    }
  }

  function goHome() {
    navigate('/', { replace: true })
    // Pequeño delay para que el navegador procese la transición antes
    // de abrir el modal de login que vive en App.jsx.
    setTimeout(() => onLoginOpen?.(), 60)
  }

  if (missingToken) {
    return (
      <div className="activate-shell">
        <div className="activate-card">
          <h1>Enlace no válido</h1>
          <p>Esta URL no contiene un token de restablecimiento. Vuelve a abrir el
            enlace que recibiste por email, o pide uno nuevo desde la pantalla
            de inicio de sesión ("¿Olvidaste tu contraseña?").</p>
          <a className="activate-btn ghost" href="/">Volver al inicio</a>
        </div>
      </div>
    )
  }

  if (done) {
    return (
      <div className="activate-shell">
        <div className="activate-card">
          <div className="activate-eyebrow">Listo</div>
          <h1>Contraseña actualizada</h1>
          <p>
            Tu nueva contraseña ya está activa. Inicia sesión con ella para
            entrar al portal.
          </p>
          <button type="button" className="activate-btn primary" onClick={goHome}>
            Iniciar sesión
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="activate-shell">
      <div className="activate-card">
        <div className="activate-eyebrow">Restablecer contraseña</div>
        <h1>Nueva contraseña</h1>
        <p>
          Elige una contraseña nueva para tu cuenta. El enlace caduca en una
          hora y sólo puede usarse una vez.
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
            {loading ? 'Guardando…' : 'Establecer contraseña'}
          </button>
        </form>

        <div className="activate-hint">
          ¿El enlace no funciona? Pide otro desde "¿Olvidaste tu contraseña?"
          en la pantalla de inicio de sesión.
        </div>
      </div>
    </div>
  )
}
