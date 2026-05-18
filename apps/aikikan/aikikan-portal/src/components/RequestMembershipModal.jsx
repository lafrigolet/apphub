// Modal "Solicitar alta" — Ruta 1 del flujo de approval.
// El visitante envía email + nombre + notas opcionales. El backend
// crea el user en pending_approval=true. El admin lo verá en
// /consola/usuarios > Solicitudes pendientes y podrá aprobar/rechazar.
//
// No abre sesión — el usuario recibe un email con magic-link sólo
// cuando el admin apruebe.

import { useEffect, useState } from 'react'
import * as auth from '../lib/auth.js'

export default function RequestMembershipModal({ onClose, onSubmitted }) {
  const [email, setEmail]             = useState('')
  const [displayName, setDisplayName] = useState('')
  const [notes, setNotes]             = useState('')
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
      await auth.requestMembership({
        email:       email.trim(),
        displayName: displayName.trim() || undefined,
        notes:       notes.trim() || undefined,
      })
      onSubmitted?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="event-modal-overlay" onClick={onClose}>
      <div className="event-modal" onClick={(e) => e.stopPropagation()}>
        <div className="event-modal-header">
          <h2>Solicitar alta</h2>
          <button className="event-modal-close" onClick={onClose} aria-label="Cerrar">×</button>
        </div>
        <form className="event-modal-body" onSubmit={submit}>
          <p style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: '.95rem', color: 'rgba(9,9,8,.7)', marginBottom: '1rem' }}>
            Rellena el formulario y un administrador revisará tu solicitud.
            Recibirás un email en cuanto se apruebe.
          </p>
          <div className="event-modal-field">
            <label className="event-modal-label">Email</label>
            <input type="email" required className="event-modal-input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nombre@ejemplo.com" />
          </div>
          <div className="event-modal-field">
            <label className="event-modal-label">Nombre completo</label>
            <input type="text" maxLength={128} className="event-modal-input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Nombre y apellidos" />
          </div>
          <div className="event-modal-field">
            <label className="event-modal-label">Dojo o notas (opcional)</label>
            <textarea rows={3} maxLength={2048} className="event-modal-input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Dojo de práctica, grado, referente…" />
          </div>
          {error && <div className="event-modal-error">{error}</div>}
          <div className="event-modal-actions">
            <button type="button" onClick={onClose} className="event-modal-btn" disabled={busy}>Cancelar</button>
            <button type="submit" className="event-modal-btn primary" disabled={busy || !email.trim()}>
              {busy ? 'Enviando…' : 'Enviar solicitud'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
