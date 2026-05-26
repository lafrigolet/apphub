import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { login, isAdminRole, clearSession } from '../../lib/auth.js'

export default function AdminLogin() {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [busy, setBusy]         = useState(false)
  const navigate = useNavigate()

  async function onSubmit(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const data = await login({ email, password })
      if (!isAdminRole(data.role)) {
        clearSession()
        setError('Esta cuenta no tiene permisos de administración.')
        return
      }
      navigate('/admin/inquiries', { replace: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-bone flex items-center justify-center p-6">
      <div className="w-full max-w-sm bg-white rounded-3xl shadow-lift border border-ink-900/5 p-8">
        <a href="/" className="flex items-center gap-2.5 mb-6">
          <span className="relative inline-flex items-center justify-center w-10 h-10 rounded-xl bg-electric-500 text-white shadow-electric">
            <span className="font-display font-bold text-sm tracking-tight">JS</span>
          </span>
          <span className="font-display text-xl font-semibold tracking-tight">JS Electric<span className="text-electric-500">.</span></span>
        </a>
        <h1 className="font-display text-2xl font-semibold mb-1">Acceso admin</h1>
        <p className="text-sm text-ink-700 mb-6">Bandeja de leads del formulario de contacto.</p>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-ink-700 mb-1.5">Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus
              className="field w-full px-4 py-3 rounded-xl border border-ink-900/10 bg-bone/50 text-sm"
              placeholder="admin@jselectric.es" />
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-700 mb-1.5">Contraseña</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
              className="field w-full px-4 py-3 rounded-xl border border-ink-900/10 bg-bone/50 text-sm" />
          </div>

          {error && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
          )}

          <button type="submit" disabled={busy}
            className="btn-primary w-full inline-flex items-center justify-center gap-2 bg-ink-900 text-white px-6 py-3.5 rounded-full font-medium shadow-lift disabled:opacity-60 disabled:cursor-not-allowed">
            {busy ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  )
}
