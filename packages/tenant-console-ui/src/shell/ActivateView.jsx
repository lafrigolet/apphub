import { useEffect, useState } from 'react'
import { activate } from './lib/auth'

// /activate?token=... — landing del magic-link de bootstrap. Se renderiza
// cuando el shell detecta esa pathname antes de pasar al flujo normal de
// login/dashboard. Tras un activate exitoso, el shell hace recarga
// completa (window.location='/') para que el AppProvider arranque ya
// con la nueva identidad y el panel "Configura tu cuenta" como
// dashboard primario.
export default function ActivateView() {
  const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams()
  const token = params.get('token') ?? ''

  const [password, setPassword] = useState('')
  const [confirm, setConfirm]   = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState(null)

  // Si no hay token la URL es inválida (e.g. el usuario navegó a /activate
  // a mano). Se enseña un mensaje claro y un botón para volver al inicio.
  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-paper p-8">
        <div className="max-w-md bg-white border border-line rounded-2xl shadow-card p-8">
          <div className="text-[12px] uppercase tracking-[0.18em] text-ink3 mb-2">Activación</div>
          <h1 className="font-display text-[28px] tracking-tight mb-3">Enlace no válido</h1>
          <p className="text-[14px] text-ink2 leading-relaxed">
            Esta URL no contiene un token de activación. Vuelve a abrir el enlace
            del email que recibiste, o pide al equipo de plataforma que te
            reenvíe uno.
          </p>
          <a href="/" className="btn btn-ghost mt-5 inline-block">Volver al inicio</a>
        </div>
      </div>
    )
  }

  async function onSubmit(e) {
    e.preventDefault()
    setError(null)
    if (password.length < 8)  return setError('La contraseña debe tener al menos 8 caracteres.')
    if (password !== confirm) return setError('Las contraseñas no coinciden.')
    setLoading(true)
    try {
      await activate({ token, password })
      // Hard reload para que el AppProvider relea identity desde
      // localStorage y monte el shell con manifests + bootstrap panel.
      window.location.replace('/')
    } catch (err) {
      setError(err.message ?? 'No se pudo activar la cuenta.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-paper p-8">
      <div className="max-w-md w-full bg-white border border-line rounded-2xl shadow-card p-8">
        <div className="text-[12px] uppercase tracking-[0.18em] text-ink3 mb-2">Activación</div>
        <h1 className="font-display text-[36px] leading-tight tracking-tight mb-3">
          <span className="italic font-normal">Bienvenido</span>
        </h1>
        <p className="text-[14px] text-ink2 leading-relaxed mb-6">
          Estás a un paso de activar tu cuenta. Elige una contraseña
          para empezar a usar tu workspace.
        </p>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <div className="label mb-1.5">Contraseña</div>
            <input
              type="password"
              autoComplete="new-password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
              autoFocus
            />
          </div>
          <div>
            <div className="label mb-1.5">Repite la contraseña</div>
            <input
              type="password"
              autoComplete="new-password"
              className="input"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              minLength={8}
              required
            />
          </div>

          {error && (
            <div className="bg-dangerbg border border-line rounded-lg p-3 text-[12.5px] text-danger">
              {error}
            </div>
          )}

          <button type="submit" className="btn btn-primary w-full" disabled={loading}>
            {loading ? 'Activando…' : 'Activar mi cuenta'}
          </button>
        </form>

        <div className="text-[12px] text-ink3 mt-5 leading-relaxed border-t border-line pt-4">
          ¿Problemas con el enlace? Pide al equipo de plataforma que te reenvíe el
          email — los enlaces caducan a los 7 días y sólo pueden usarse una vez.
        </div>
      </div>
    </div>
  )
}
