import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import * as auth from '../lib/auth.js'

// Página /magic-login?token=... — landing del magic-link de login
// passwordless. Consume el token, guarda la sesión y redirige según rol
// (admin → /consola, socio → /area-socio).
//
// Distinto de /reset-password (que SÓLO cambia la contraseña sin abrir
// sesión) y de /activate (owner-bootstrap, una sola vez). Este flujo es
// el equivalente passwordless del login normal: cada vez que el user
// pide acceso, recibe un nuevo enlace y se loguea con él.
export default function MagicLoginView({ onLoggedIn }) {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const token = params.get('token') ?? ''

  const [error, setError] = useState(null)
  const [missingToken, setMissingToken] = useState(false)

  useEffect(() => {
    if (!token) { setMissingToken(true); return }
    let cancelled = false
    auth.loginWithMagicLink(token)
      .then((data) => {
        if (cancelled) return
        onLoggedIn?.(data)
        // Redirección según rol — mismo handler que handleLoggedIn de App.jsx,
        // pero como este componente es standalone (no monta el modal de Login),
        // navegamos directamente.
        const target = ['owner', 'admin', 'staff', 'super_admin'].includes(data.role)
          ? '/consola'
          : '/area-socio'
        navigate(target, { replace: true })
      })
      .catch((err) => {
        if (!cancelled) setError(err.message ?? 'No se pudo iniciar sesión con el enlace.')
      })
    return () => { cancelled = true }
  }, [token])

  if (missingToken) {
    return (
      <div className="activate-shell">
        <div className="activate-card">
          <h1>Enlace no válido</h1>
          <p>Esta URL no contiene un token de acceso. Vuelve a abrir el
            enlace que recibiste por email, o pide uno nuevo desde la
            pantalla de inicio de sesión.</p>
          <a className="activate-btn ghost" href="/">Volver al inicio</a>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="activate-shell">
        <div className="activate-card">
          <div className="activate-eyebrow">No se pudo entrar</div>
          <h1>Enlace caducado o usado</h1>
          <p>{error}</p>
          <p style={{ marginTop: '1rem' }}>
            Pide un nuevo enlace desde la pantalla de inicio de sesión —
            los enlaces son de un solo uso y caducan a los 15 minutos.
          </p>
          <a className="activate-btn primary" href="/">Volver al inicio</a>
        </div>
      </div>
    )
  }

  return (
    <div className="activate-shell">
      <div className="activate-card">
        <div className="activate-eyebrow">Accediendo</div>
        <h1>Iniciando sesión…</h1>
        <p>Estamos validando tu enlace.</p>
      </div>
    </div>
  )
}
