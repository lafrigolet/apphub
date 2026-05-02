import { useState } from 'react'
import { login } from './lib/auth'

export default function LoginView({ onSuccess }) {
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState(null)
  const [busy,     setBusy]     = useState(false)

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      await login({ email, password })
      onSuccess()
    } catch (err) {
      setError(err.message ?? 'No se pudo iniciar sesión')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-paper">
      <form onSubmit={submit} className="w-full max-w-sm bg-white border border-line rounded-2xl shadow-card p-8 space-y-5">
        <div>
          <div className="text-[12px] uppercase tracking-[0.18em] text-ink3 mb-2">Tenant Console</div>
          <h1 className="font-display text-[32px] leading-tight tracking-tight">
            <span className="italic font-normal">Inicia sesión</span>
          </h1>
        </div>
        <div>
          <label className="block text-[12px] uppercase tracking-[0.14em] text-ink3 mb-1">Email</label>
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full border border-line rounded-md px-3 py-2 text-[14px] focus:outline-none focus:border-ink2"
          />
        </div>
        <div>
          <label className="block text-[12px] uppercase tracking-[0.14em] text-ink3 mb-1">Contraseña</label>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full border border-line rounded-md px-3 py-2 text-[14px] focus:outline-none focus:border-ink2"
          />
        </div>
        {error && (
          <div className="bg-dangerbg border border-line rounded-md p-3 text-[12.5px] text-danger">{error}</div>
        )}
        <button
          type="submit"
          disabled={busy}
          className="w-full px-4 py-2 rounded-md bg-ink text-paper text-[14px] font-medium disabled:opacity-50"
        >
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </main>
  )
}
