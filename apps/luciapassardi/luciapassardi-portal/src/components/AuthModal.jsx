import { useState } from 'react'
import { useSession } from '../context/SessionContext.jsx'
import { Close, Leaf } from './icons.jsx'

// Modal de acceso de alumna: login + registro (platform/auth). Tras autenticar,
// SessionContext ejecuta la acción encolada (reservar / comprar bono).
export default function AuthModal() {
  const { authOpen, setAuthOpen, login, register } = useSession()
  const [modo, setModo] = useState('login')   // 'login' | 'registro'
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  if (!authOpen) return null

  async function onSubmit(e) {
    e.preventDefault()
    setErr(''); setBusy(true)
    try {
      if (modo === 'registro') await register(form)
      else await login({ email: form.email, password: form.password })
    } catch (e2) {
      setErr(e2.message ?? 'No se pudo completar')
    } finally { setBusy(false) }
  }

  const field = 'w-full rounded-xl border border-tinta/15 bg-crema px-4 py-2.5 focus:outline-none focus:border-teal-500'

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-tinta/40 backdrop-blur-sm" onClick={() => setAuthOpen(false)} />
      <div className="relative w-full max-w-sm card-zen p-7 bg-crema">
        <button onClick={() => setAuthOpen(false)} aria-label="Cerrar" className="absolute top-4 right-4 p-1.5 text-tinta/50 hover:text-teal-600"><Close className="w-5 h-5" /></button>
        <div className="flex items-center gap-2 mb-1">
          <span className="w-9 h-9 rounded-full bg-salvia-400/30 text-teal-600 flex items-center justify-center"><Leaf className="w-5 h-5" /></span>
          <span className="display text-2xl">Mi cuenta</span>
        </div>
        <p className="text-sm text-tinta/60 mb-5">{modo === 'login' ? 'Entra para reservar clases y comprar bonos.' : 'Crea tu cuenta de alumna en un minuto.'}</p>

        <form onSubmit={onSubmit} className="space-y-3">
          {modo === 'registro' && (
            <input value={form.name} onChange={set('name')} placeholder="Nombre" className={field} />
          )}
          <input type="email" required value={form.email} onChange={set('email')} placeholder="Email" className={field} />
          <input type="password" required minLength={8} value={form.password} onChange={set('password')} placeholder="Contraseña (mín. 8)" className={field} />
          {err && <p className="text-sm text-red-700 bg-red-500/10 rounded-lg px-3 py-2">{err}</p>}
          <button type="submit" disabled={busy} className="btn-zen btn-fill w-full justify-center">
            {busy ? 'Un momento…' : modo === 'login' ? 'Entrar' : 'Crear cuenta'}
          </button>
        </form>

        <p className="text-sm text-tinta/60 text-center mt-4">
          {modo === 'login' ? (
            <>¿Aún no tienes cuenta? <button onClick={() => { setModo('registro'); setErr('') }} className="text-teal-700 font-semibold hover:text-teal-600">Regístrate</button></>
          ) : (
            <>¿Ya tienes cuenta? <button onClick={() => { setModo('login'); setErr('') }} className="text-teal-700 font-semibold hover:text-teal-600">Entra</button></>
          )}
        </p>
      </div>
    </div>
  )
}
