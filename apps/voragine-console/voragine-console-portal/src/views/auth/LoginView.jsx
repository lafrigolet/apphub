import { useState } from 'react'
import { login } from '../../lib/auth'

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
    <div className="min-h-screen bg-paper flex items-center justify-center p-6">
      <form onSubmit={onSubmit} className="w-full max-w-md bg-paper2 border border-line rounded-2xl p-8 shadow-card">
        <h1 className="text-2xl font-display text-ink mb-1">Voragine Console</h1>
        <p className="text-sm text-ink3 mb-6">Inicia sesión con tu cuenta.</p>

        <label className="block text-xs text-ink2 mb-1">Email</label>
        <input
          type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
          className="input w-full mb-4 px-3 py-2 text-ink"
          autoComplete="username"
        />

        <label className="block text-xs text-ink2 mb-1">Contraseña</label>
        <input
          type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
          className="input w-full mb-4 px-3 py-2 text-ink"
          autoComplete="current-password"
        />

        {error && (
          <div className="mb-3 text-sm text-danger bg-dangerbg border border-line rounded-lg p-3">{error}</div>
        )}

        <button
          type="submit" disabled={loading}
          className="w-full py-2 bg-accent text-white rounded-lg hover:bg-accent2 disabled:opacity-50"
        >
          {loading ? 'Entrando…' : 'Entrar'}
        </button>

        {import.meta.env.DEV && (
          <p className="mt-6 text-xs text-ink3 leading-relaxed">
            Dev: prueba <code className="font-mono text-ink">ana@voragine.local</code> / <code className="font-mono">password123</code> como staff,
            o <code className="font-mono">pedro@tiendaana.com</code> / <code className="font-mono">password123</code> como owner.
          </p>
        )}
      </form>
    </div>
  )
}
