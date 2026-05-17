import { useEffect, useState } from 'react'
import { getAccessToken } from '../lib/auth.js'

// Modal de alta/edición de un evento (service_session de un service kind='event').
// Si `existing` viene poblado, modo edición → PATCH /api/services/sessions/:id.
// Si no, modo alta → POST /api/services/:anchorId/sessions.
//
// Endpoint reference: platform/services/src/routes/services.routes.js
//   sessionBody = { startsAt, endsAt, capacity?, location?, description?, ... }

function authFetch(url, opts = {}) {
  const token = getAccessToken()
  return fetch(url, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(opts.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
}

export async function deleteEvent(sessionId) {
  const res = await authFetch(`/api/services/sessions/${sessionId}`, { method: 'DELETE' })
  if (!res.ok) {
    const j = await res.json().catch(() => ({}))
    throw new Error(j.error?.message ?? res.statusText)
  }
}

// Parse ISO → { date: 'YYYY-MM-DD', time: 'HH:MM' } in local timezone.
function splitIso(iso) {
  if (!iso) return { date: '', time: '' }
  const d = new Date(iso)
  const pad = (n) => String(n).padStart(2, '0')
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  }
}

export default function EventModal({ anchorServiceId, existing, onClose, onSaved }) {
  const init = existing
    ? {
        ...splitIso(existing.starts_at),
        endTime: splitIso(existing.ends_at).time || '18:00',
        description: existing.description ?? '',
        location:    existing.location    ?? '',
        capacity:    existing.capacity != null ? String(existing.capacity) : '',
      }
    : { date: '', time: '09:00', endTime: '18:00', description: '', location: '', capacity: '' }

  const [date, setDate]               = useState(init.date)
  const [startTime, setStartTime]     = useState(init.time || '09:00')
  const [endTime, setEndTime]         = useState(init.endTime)
  const [description, setDescription] = useState(init.description)
  const [location, setLocation]       = useState(init.location)
  const [capacity, setCapacity]       = useState(init.capacity)
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
      const startsAt = new Date(`${date}T${startTime}:00`).toISOString()
      const endsAt   = new Date(`${date}T${endTime}:00`).toISOString()
      const body = {
        startsAt, endsAt,
        description: description.trim() || undefined,
        location:    location.trim()    || undefined,
        capacity:    capacity ? Number(capacity) : undefined,
      }
      const url = existing
        ? `/api/services/sessions/${existing.id}`
        : `/api/services/${anchorServiceId}/sessions`
      const res = await authFetch(url, {
        method: existing ? 'PATCH' : 'POST',
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error?.message ?? res.statusText)
      onSaved?.()
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
          <h2>{existing ? 'Editar evento' : 'Nuevo evento'}</h2>
          <button className="event-modal-close" onClick={onClose} aria-label="Cerrar">×</button>
        </div>
        <form className="event-modal-body" onSubmit={submit}>
          <div className="event-modal-field">
            <label className="event-modal-label">Fecha</label>
            <input type="date" required className="event-modal-input" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.65rem' }}>
            <div className="event-modal-field">
              <label className="event-modal-label">Hora inicio</label>
              <input type="time" required className="event-modal-input" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </div>
            <div className="event-modal-field">
              <label className="event-modal-label">Hora fin</label>
              <input type="time" required className="event-modal-input" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </div>
          </div>
          <div className="event-modal-field">
            <label className="event-modal-label">Título</label>
            <input type="text" maxLength={256} className="event-modal-input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Seminario de Primavera con Tiki Shewan" />
          </div>
          <div className="event-modal-field">
            <label className="event-modal-label">Ubicación</label>
            <input type="text" maxLength={256} className="event-modal-input" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Polideportivo · Madrid" />
          </div>
          <div className="event-modal-field">
            <label className="event-modal-label">Aforo (opcional)</label>
            <input type="number" min="1" className="event-modal-input" value={capacity} onChange={(e) => setCapacity(e.target.value)} placeholder="200" />
          </div>
          {error && <div className="event-modal-error">{error}</div>}
          <div className="event-modal-actions">
            <button type="button" onClick={onClose} className="event-modal-btn" disabled={busy}>Cancelar</button>
            <button type="submit" className="event-modal-btn primary" disabled={busy || !date}>
              {busy ? 'Guardando…' : existing ? 'Guardar' : 'Crear'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
