import { useState } from 'react'
import { login } from '../../lib/auth.js'

// Login del owner/staff. Estética zen, coherente con la landing.
export default function Login({ onLogged }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function onSubmit(e) {
    e.preventDefault()
    setError(''); setLoading(true)
    try {
      const id = await login({ email, password })
      onLogged?.(id)
    } catch (err) {
      setError(err.message ?? 'No se pudo iniciar sesión')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-[100svh] grid place-items-center wash-salvia px-5">
      <form onSubmit={onSubmit} className="card-zen w-full max-w-sm p-8">
        <p className="eyebrow mb-2">Consola · Lucía Passardi</p>
        <h1 className="display text-3xl mb-6">Inicia sesión</h1>

        <label className="block text-[12px] uppercase tracking-widest text-tinta/45 font-semibold mb-1">Email</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus
          className="w-full rounded-xl border border-tinta/15 bg-crema px-4 py-2.5 mb-4 focus:outline-none focus:border-teal-500" />

        <label className="block text-[12px] uppercase tracking-widest text-tinta/45 font-semibold mb-1">Contraseña</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
          className="w-full rounded-xl border border-tinta/15 bg-crema px-4 py-2.5 mb-5 focus:outline-none focus:border-teal-500" />

        {error && <p className="text-sm text-red-700 bg-red-500/10 rounded-lg px-3 py-2 mb-4">{error}</p>}

        <button type="submit" disabled={loading} className="btn-zen btn-fill w-full justify-center">
          {loading ? 'Entrando…' : 'Entrar'}
        </button>
        <a href="/" className="block text-center text-sm text-tinta/55 hover:text-teal-600 mt-4">← Volver a la web</a>
      </form>
    </div>
  )
}
