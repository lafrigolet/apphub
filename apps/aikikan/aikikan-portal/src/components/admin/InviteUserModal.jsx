// Modal de invitación. Usa el endpoint atómico POST /api/users/invite
// (platform/auth) que crea el user + emite el evento de magic-link.
// El invitado recibe email vía Resend con un link /reset-password?token=…
// que cae en ResetPasswordView del aikikan-portal.

import { useEffect, useState } from 'react'
import { api } from '../../lib/api.js'

const APP_ID = 'aikikan'

export default function InviteUserModal({ tenantId, onClose, onCreated }) {
  const [email, setEmail]             = useState('')
  const [displayName, setDisplayName] = useState('')
  const [role, setRole]               = useState('user')
  const [busy, setBusy]               = useState(false)
  const [error, setError]             = useState(null)

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      await api('POST', '/api/users/invite', {
        appId: APP_ID,
        tenantId,
        email: email.trim(),
        role,
        ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
      })
      onCreated?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="user-modal-overlay" onClick={onClose}>
      <div className="user-modal" onClick={(e) => e.stopPropagation()}>
        <div className="user-modal-header">
          <h2>Invitar usuario</h2>
          <button className="user-modal-close" onClick={onClose} aria-label="Cerrar">×</button>
        </div>
        <form className="user-modal-body" onSubmit={submit}>
          <p className="admin-section-subtitle" style={{ marginBottom: '1rem' }}>
            Se le enviará un correo con un enlace para fijar su contraseña.
            La cuenta queda activa cuando complete el flujo.
          </p>
          <label className="user-field">
            <span className="user-field-label">Email</span>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="socio@example.com" />
          </label>
          <label className="user-field">
            <span className="user-field-label">Nombre (opcional)</span>
            <input type="text" maxLength={128} value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Nombre completo" />
          </label>
          <label className="user-field">
            <span className="user-field-label">Rol</span>
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="user">Socio</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          {error && <p className="admin-error" style={{ padding: '.5rem 0' }}>{error}</p>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '.5rem', marginTop: '1rem' }}>
            <button type="button" className="admin-btn" onClick={onClose} disabled={busy}>Cancelar</button>
            <button type="submit" className="admin-btn admin-btn-primary" disabled={busy || !email.trim()}>
              {busy ? 'Enviando…' : 'Enviar invitación'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
