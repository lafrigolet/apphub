import { useEffect, useMemo, useState } from 'react'
import { getAccessToken, getIdentity, isAdminRole } from '../lib/auth.js'

const MONTHS_ES = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC']

// Visualization helpers — el endpoint devuelve `date` (YYYY-MM-DD); el
// landing muestra mes (3 letras) + año + nombre + localización.
function formatDate(iso) {
  const d = new Date(iso)
  return { month: MONTHS_ES[d.getMonth()], year: String(d.getFullYear()) }
}

async function api(method, path, body) {
  const token = getAccessToken()
  const res = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
  })
  if (res.status === 204) return null
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error?.message ?? res.statusText)
  return json
}

export default function Events() {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState(null)
  const [modalOpen, setModalOpen] = useState(false)

  const identity = getIdentity()
  const isAdmin  = identity && isAdminRole(identity.role)

  const load = () => {
    setLoading(true); setError(null)
    api('GET', '/api/aikikan/events')
      .then(setEvents)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  async function handleDelete(id) {
    if (!confirm('¿Eliminar este evento?')) return
    try { await api('DELETE', `/api/aikikan/events/${id}`); load() }
    catch (e) { alert(e.message) }
  }

  return (
    <section id="eventos">
      <div className="section-label reveal"><span className="slash">/</span> Próximos Eventos</div>
      <h2 className="section-title reveal">AGENDA<br />2025–2026</h2>

      {loading && <p className="dojos-empty">/ Cargando…</p>}
      {error   && <p className="dojos-empty" style={{ color: 'var(--accent)' }}>/ Error: {error}</p>}

      {!loading && !error && (
        <div className="events-list">
          {events.map((e) => {
            const { month, year } = formatDate(e.date)
            return (
              <div key={e.id} className="event-row reveal">
                <div className="event-date">{month}<small>{year}</small></div>
                <div>
                  <p className="event-name">{e.name}</p>
                  <p className="event-loc">{e.location}</p>
                </div>
                {isAdmin ? (
                  <button
                    onClick={() => handleDelete(e.id)}
                    className="event-trash"
                    title="Eliminar evento"
                    aria-label="Eliminar evento"
                  >×</button>
                ) : (
                  <span className="event-arrow">→</span>
                )}
              </div>
            )
          })}
          {events.length === 0 && <p className="dojos-empty">/ Sin eventos en agenda.</p>}
        </div>
      )}

      <div style={{ marginTop: '2.5rem' }} className="reveal">
        {isAdmin ? (
          <button onClick={() => setModalOpen(true)} className="btn-outline">
            <span className="slash">/</span> + Añadir evento
          </button>
        ) : (
          <a href="https://www.aikikan.es/events" className="btn-outline"><span className="slash">/</span> Ver todos los eventos</a>
        )}
      </div>

      {modalOpen && (
        <NewEventModal
          onClose={() => setModalOpen(false)}
          onCreated={() => { setModalOpen(false); load() }}
        />
      )}
    </section>
  )
}

function NewEventModal({ onClose, onCreated }) {
  const [date, setDate]     = useState('')
  const [name, setName]     = useState('')
  const [location, setLoc]  = useState('')
  const [busy, setBusy]     = useState(false)
  const [error, setError]   = useState(null)

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      await api('POST', '/api/aikikan/events', {
        date, name,
        ...(location ? { location } : {}),
      })
      onCreated()
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
