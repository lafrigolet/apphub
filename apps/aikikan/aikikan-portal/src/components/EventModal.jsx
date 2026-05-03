import { useEffect, useState } from 'react'
import { getAccessToken } from '../lib/auth.js'

// Modal compartido por Hero y Events para crear un evento. POST a
// /api/aikikan/events; cuando devuelve 201 invoca onCreated() para que
// la lista del padre se refresque.
async function createEvent(body) {
  const token = getAccessToken()
  const res = await fetch('/api/aikikan/events', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error?.message ?? res.statusText)
  return json
}

export default function EventModal({ onClose, onCreated }) {
  const [date, setDate]    = useState('')
  const [name, setName]    = useState('')
  const [location, setLoc] = useState('')
  const [busy, setBusy]    = useState(false)
  const [error, setError]  = useState(null)

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      await createEvent({ date, name, ...(location ? { location } : {}) })
      onCreated?.()
    } catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }

  return (
    <div className="event-modal-overlay" onClick={onClose}>
      <div className="event-modal" onClick={(e) => e.stopPropagation()}>
        <div className="event-modal-header">
          <h2>Nuevo evento</h2>
          <button className="event-modal-close" onClick={onClose} aria-label="Cerrar">×</button>
        </div>
        <form className="event-modal-body" onSubmit={submit}>
          <div className="event-modal-field">
            <label className="event-modal-label">Fecha</label>
            <input type="date" required className="event-modal-input" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="event-modal-field">
            <label className="event-modal-label">Nombre del evento</label>
            <input type="text" required className="event-modal-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={256} placeholder="Seminario Nacional de Primavera" />
          </div>
          <div className="event-modal-field">
            <label className="event-modal-label">Ubicación (opcional)</label>
            <input type="text" className="event-modal-input" value={location} onChange={(e) => setLoc(e.target.value)} maxLength={256} placeholder="/ Madrid · Convocatoria abierta" />
          </div>
          {error && <div className="event-modal-error">{error}</div>}
          <div className="event-modal-actions">
            <button type="button" onClick={onClose} className="event-modal-btn" disabled={busy}>Cancelar</button>
            <button type="submit" className="event-modal-btn primary" disabled={busy || !date || !name.trim()}>
              {busy ? 'Guardando…' : 'Crear'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// Small helper used by both Hero and Events lists to delete an event.
export async function deleteEvent(id) {
  const token = getAccessToken()
  const res = await fetch(`/api/aikikan/events/${id}`, {
    method: 'DELETE',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) {
    const json = await res.json().catch(() => ({}))
    throw new Error(json.error?.message ?? res.statusText)
  }
}
