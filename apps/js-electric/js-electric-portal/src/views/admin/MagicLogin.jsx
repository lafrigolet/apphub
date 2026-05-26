import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { loginWithMagicLink, isAdminRole, clearSession } from '../../lib/auth.js'

// Landing pública de /magic-login?token=... — el admin aterriza aquí
// desde el email enviado por platform/notifications. Consume el token
// (POST /v1/auth/login-with-magic-link), guarda la sesión y redirige a
// /admin/inquiries si el role es admin.
//
// Si el usuario no tiene rol admin (caso improbable porque el único user
// seeded es owner) limpiamos la sesión y mostramos un mensaje — evita
// que se cuele un user "user" al área admin solo por tener token válido.
export default function MagicLogin() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const token = params.get('token') ?? ''

  const [error, setError]               = useState(null)
  const [missingToken, setMissingToken] = useState(false)

  useEffect(() => {
    if (!token) { setMissingToken(true); return }
    let cancelled = false
    loginWithMagicLink(token)
      .then((data) => {
        if (cancelled) return
        if (!isAdminRole(data.role)) {
          clearSession()
          setError('Esta cuenta no tiene permisos de administración.')
          return
        }
        navigate('/admin/inquiries', { replace: true })
      })
      .catch((err) => {
        if (!cancelled) setError(err.message ?? 'No se pudo iniciar sesión con el enlace.')
      })
    return () => { cancelled = true }
  }, [token, navigate])

  return (
    <div className="min-h-screen bg-bone flex items-center justify-center p-6">
      <div className="w-full max-w-sm bg-white rounded-3xl shadow-lift border border-ink-900/5 p-8">
        <a href="/" className="flex items-center gap-2.5 mb-6">
          <span className="relative inline-flex items-center justify-center w-10 h-10 rounded-xl bg-electric-500 text-white shadow-electric">
            <span className="font-display font-bold text-sm tracking-tight">JS</span>
          </span>
          <span className="font-display text-xl font-semibold tracking-tight">JS Electric<span className="text-electric-500">.</span></span>
        </a>

        {missingToken && (
          <>
            <h1 className="font-display text-2xl font-semibold mb-1">Enlace no válido</h1>
            <p className="text-sm text-ink-700 mb-6">
              Esta URL no contiene token. Vuelve a abrir el enlace que recibiste por email o pide uno nuevo desde la pantalla de inicio.
            </p>
            <a href="/admin/login" className="text-sm font-medium text-electric-700 hover:text-electric-900 transition">
              ← Volver a la pantalla de inicio
            </a>
          </>
        )}

        {error && !missingToken && (
          <>
            <h1 className="font-display text-2xl font-semibold mb-1">No se pudo entrar</h1>
            <p className="text-sm text-ink-700 mb-2">{error}</p>
            <p className="text-xs text-ink-700/70 mb-6">
              Los enlaces caducan a los 15 minutos y son de un solo uso.
            </p>
            <a href="/admin/login" className="text-sm font-medium text-electric-700 hover:text-electric-900 transition">
              ← Pedir un nuevo enlace
            </a>
          </>
        )}

        {!missingToken && !error && (
          <>
            <h1 className="font-display text-2xl font-semibold mb-1">Accediendo…</h1>
            <p className="text-sm text-ink-700">Estamos validando tu enlace.</p>
          </>
        )}
      </div>
    </div>
  )
}
