import { useEffect, useState } from 'react'
import { loginWithMagicLink } from '../../lib/auth'

// Callback view for /magic-login?token=… — the user lands here from the
// email link. We redeem the token for an access JWT once, scrub the URL of
// the token (so reloads don't re-fire), and hand off to onSuccess() which
// flips AppContext into the authenticated shell.

export default function MagicLoginView({ onSuccess }) {
  const [error, setError] = useState(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const token  = params.get('token')
    if (!token) {
      setError('Falta el token en la URL')
      return
    }
    let cancelled = false
    loginWithMagicLink({ token })
      .then(() => {
        if (cancelled) return
        // Clean URL: strip the token from history so a refresh doesn't replay
        // the redemption (which would 401 — magic links are one-shot).
        window.history.replaceState({}, '', '/')
        onSuccess()
      })
      .catch((err) => {
        if (cancelled) return
        setError(err.message ?? 'Enlace inválido o caducado')
      })
    return () => { cancelled = true }
  }, [onSuccess])

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-white p-6">
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 -z-10 h-full bg-[radial-gradient(ellipse_at_top,rgba(99,102,241,0.18),transparent_60%)]"
      />
      <div className="w-full max-w-md text-center">
        <div className="mb-8 flex items-center justify-center gap-2 text-slate-900">
          <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full bg-indigo-600" />
          <span className="text-base font-semibold tracking-tight">Hulkstein Console</span>
        </div>
        {error ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">
            <p className="font-medium">{error}</p>
            <a href="/" className="mt-4 inline-block text-indigo-600 hover:text-indigo-700">Volver al login</a>
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-card text-slate-600 text-sm">
            <svg className="mx-auto h-6 w-6 animate-spin text-indigo-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="9" strokeOpacity="0.25" />
              <path d="M21 12a9 9 0 0 0-9-9" strokeLinecap="round" />
            </svg>
            <p className="mt-4">Validando enlace…</p>
          </div>
        )}
      </div>
    </div>
  )
}
