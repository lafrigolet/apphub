import { useEffect, useState } from 'react'
import { getIdentity, isAdminRole } from '../lib/auth.js'
import EventModal, { deleteEvent } from './EventModal.jsx'

const MONTHS_ES = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC']

function formatDate(iso) {
  const d = new Date(iso)
  return { month: MONTHS_ES[d.getMonth()], year: String(d.getFullYear()) }
}

export default function Events() {
  const [events, setEvents]     = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)
  const [modalOpen, setModalOpen] = useState(false)

  const identity = getIdentity()
  const isAdmin  = identity && isAdminRole(identity.role)

  function load() {
    setLoading(true); setError(null)
    fetch('/api/aikikan/events')
      .then((r) => r.ok ? r.json() : Promise.reject(r))
      .then((arr) => setEvents(Array.isArray(arr) ? arr : []))
      .catch((err) => setError(err.message ?? 'Error'))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  async function handleDelete(id) {
    if (!confirm('¿Eliminar este evento?')) return
    try { await deleteEvent(id); load() }
    catch (err) { alert(err.message) }
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
        <EventModal
          onClose={() => setModalOpen(false)}
          onCreated={() => { setModalOpen(false); load() }}
        />
      )}
    </section>
  )
}
