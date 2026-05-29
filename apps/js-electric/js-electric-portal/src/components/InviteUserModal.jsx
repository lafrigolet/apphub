import { useEffect, useState } from 'react'
import { Arrow } from './icons.jsx'
import { api } from '../lib/api.js'
import { APP_ROLES, getIdentity } from '../lib/auth.js'

// Modal de invitación de usuario nuevo. Patrón visual lifted de
// BudgetRequestModal: overlay + tarjeta centrada + escape para cerrar.
// El submit llama POST /api/users/invite que crea el row + emite
// auth.signup.approved (notifications manda el magic-link al invitado).
export default function InviteUserModal({ open, onClose, onCreated }) {
  const identity = getIdentity()
  const [email, setEmail]             = useState('')
  const [role, setRole]               = useState('user')
  const [displayName, setDisplayName] = useState('')
  const [submitting, setSubmitting]   = useState(false)
  const [error, setError]             = useState('')

  useEffect(() => {
    if (open) {
      setEmail(''); setRole('user'); setDisplayName(''); setError('')
      const onKey = (e) => { if (e.key === 'Escape') onClose() }
      document.addEventListener('keydown', onKey)
      document.body.style.overflow = 'hidden'
      return () => {
        document.removeEventListener('keydown', onKey)
        document.body.style.overflow = ''
      }
    }
  }, [open])

  if (!open) return null

  const onSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (!email) { setError('Email es obligatorio.'); return }

    setSubmitting(true)
    try {
      await api('POST', '/api/users/invite', {
        appId:       identity.appId,
        tenantId:    identity.tenantId,
        email,
        role,
        displayName: displayName || undefined,
      })
      onCreated?.()
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
         role="dialog" aria-modal="true" aria-labelledby="invite-modal-title">
      <button type="button" onClick={onClose}
        aria-label="Cerrar"
        className="absolute inset-0 bg-ink-900/70 backdrop-blur-sm" />

      <div className="relative bg-white text-ink-900 rounded-3xl shadow-lift w-full max-w-md p-7 sm:p-8 max-h-[90vh] overflow-y-auto">
        <button type="button" onClick={onClose} aria-label="Cerrar"
          className="absolute top-4 right-4 w-9 h-9 rounded-full border border-ink-900/10 hover:border-ink-900/30 flex items-center justify-center transition">
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" d="M6 6l12 12M6 18L18 6" />
          </svg>
        </button>

        <h2 id="invite-modal-title" className="font-display text-2xl font-semibold mb-1">Invitar usuario</h2>
        <p className="text-sm text-ink-700 mb-5">
          Recibirá un email con un enlace de acceso. Sin contraseña — entra directamente al hacer click.
        </p>

        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div>
            <label className="block text-xs font-medium text-ink-700 mb-1.5">Email*</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus
              className="field w-full px-4 py-3 rounded-xl border border-ink-900/10 bg-bone/50 text-sm"
              placeholder="usuario@ejemplo.com" />
          </div>

          <div>
            <label className="block text-xs font-medium text-ink-700 mb-1.5">Rol</label>
            <select value={role} onChange={(e) => setRole(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-ink-900/10 bg-bone/50 text-sm">
              {APP_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <p className="text-[11px] text-ink-700/60 mt-1.5">Define qué puede hacer en la consola. Puedes cambiarlo después.</p>
          </div>

          <div>
            <label className="block text-xs font-medium text-ink-700 mb-1.5">Display name (opcional)</label>
            <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)}
              className="field w-full px-4 py-3 rounded-xl border border-ink-900/10 bg-bone/50 text-sm"
              placeholder="Nombre visible en la consola" />
          </div>

          {error && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
          )}

          <button type="submit" disabled={submitting}
            className="btn-primary w-full inline-flex items-center justify-center gap-2 bg-ink-900 text-white px-6 py-3.5 rounded-full font-medium shadow-lift disabled:opacity-60 disabled:cursor-not-allowed">
            <span>{submitting ? 'Enviando…' : 'Enviar invitación'}</span>
            {!submitting && <Arrow />}
          </button>
        </form>
      </div>
    </div>
  )
}
