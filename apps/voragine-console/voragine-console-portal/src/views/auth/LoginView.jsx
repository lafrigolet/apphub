import { useState } from 'react'
import { login } from '../../lib/auth'

// Hulkstein-flavored login screen for the staff console. Centered card on a
// white background with a subtle indigo radial glow behind the headline,
// matching the public landing at hulkstein.com. Inputs and CTA use the
// rebrand tokens (indigo-600 / slate-*).

export default function LoginView({ onSuccess }) {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState(null)

  async function onSubmit(e) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await login({ email, password })
      onSuccess()
    } catch (err) {
      setError(err.message ?? 'No se pudo iniciar sesión')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-white p-6">
      {/* Subtle indigo radial glow — same recipe as the Hulkstein hero. */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 -z-10 h-full bg-[radial-gradient(ellipse_at_top,rgba(99,102,241,0.18),transparent_60%)]"
      />

      <div className="w-full max-w-md">
        {/* Brand mark above the card. */}
        <div className="mb-8 flex items-center justify-center gap-2 text-slate-900">
          <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full bg-indigo-600" />
          <span className="text-base font-semibold tracking-tight">Voragine Console</span>
        </div>

        <form
          onSubmit={onSubmit}
          className="rounded-2xl border border-slate-200 bg-white p-8 shadow-card"
        >
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Iniciar sesión</h1>
          <p className="mt-1.5 text-sm text-slate-500">
            Panel de administración interno. Solo personal autorizado.
          </p>

          <div className="mt-7 space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-700">Email</span>
              <input
                type="email"
                required
                autoComplete="username"
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-700">Contraseña</span>
              <input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
              />
            </label>
          </div>

          {error && (
            <div
              role="alert"
              className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-md bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading && (
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="9" strokeOpacity="0.25" />
                <path d="M21 12a9 9 0 0 0-9-9" strokeLinecap="round" />
              </svg>
            )}
            <span>{loading ? 'Entrando…' : 'Entrar'}</span>
          </button>

          {import.meta.env.DEV && (
            <p className="mt-6 text-xs leading-relaxed text-slate-500">
              Dev: prueba <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-slate-700">ana@voragine.local</code> /{' '}
              <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-slate-700">password123</code> como staff, o{' '}
              <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-slate-700">pedro@tiendaana.com</code> /{' '}
              <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-slate-700">password123</code> como owner.
            </p>
          )}
        </form>

        <p className="mt-6 text-center text-xs text-slate-500">
          ¿Buscas Hulkstein? <a href="https://hulkstein.com" className="font-medium text-indigo-600 hover:text-indigo-700">hulkstein.com</a>
        </p>
      </div>
    </div>
  )
}
