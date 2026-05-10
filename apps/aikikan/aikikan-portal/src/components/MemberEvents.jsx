import { useEffect, useState } from 'react'
import { getAccessToken } from '../lib/auth.js'

// Inscripciones del socio. Consume:
//   GET /api/aikikan/events/me            — inscripciones del socio (con datos del evento embebidos)
//   GET /api/aikikan/events               — agenda completa (para inscribirse a futuros)
//   POST /api/aikikan/events/:id/register — auto-inscribirse
//   DELETE /api/aikikan/events/:id/register — cancelar inscripción
//
// El layout es:
//   1) Inscripciones activas (futuras y pasadas) ordenadas por fecha del evento.
//   2) Agenda con el resto de eventos futuros a los que aún no estás
//      inscrito, con un botón para inscribirse.

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

const MONTHS_ES = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC']

function eventDateParts(iso) {
  const d = new Date(iso)
  return {
    month: MONTHS_ES[d.getMonth()],
    day:   String(d.getDate()).padStart(2, '0'),
    year:  String(d.getFullYear()),
  }
}

function statusLabel(status) {
  if (status === 'attended')   return 'Asistencia confirmada'
  if (status === 'cancelled')  return 'Cancelada'
  return 'Inscrito'
}

export default function MemberEvents({ onBack }) {
  const [registrations, setRegistrations] = useState([])
  const [allEvents, setAllEvents]         = useState([])
  const [loading, setLoading]             = useState(true)
  const [error, setError]                 = useState(null)
  const [busy, setBusy]                   = useState({})   // { [eventId]: 'register' | 'cancel' }

  function load() {
    setLoading(true); setError(null)
    Promise.all([
      api('GET', '/api/aikikan/events/me'),
      api('GET', '/api/aikikan/events'),
    ])
      .then(([mine, all]) => {
        setRegistrations(Array.isArray(mine) ? mine : [])
        setAllEvents(Array.isArray(all) ? all : [])
      })
      .catch((err) => setError(err.message ?? 'Error'))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  async function register(eventId) {
    setBusy((b) => ({ ...b, [eventId]: 'register' }))
    try { await api('POST', `/api/aikikan/events/${eventId}/register`); load() }
    catch (err) { alert(err.message ?? 'Error al inscribirse') }
    finally { setBusy((b) => { const n = { ...b }; delete n[eventId]; return n }) }
  }

  async function cancel(eventId) {
    if (!confirm('¿Cancelar la inscripción a este evento?')) return
    setBusy((b) => ({ ...b, [eventId]: 'cancel' }))
    try { await api('DELETE', `/api/aikikan/events/${eventId}/register`); load() }
    catch (err) { alert(err.message ?? 'Error al cancelar') }
    finally { setBusy((b) => { const n = { ...b }; delete n[eventId]; return n }) }
  }

  // Sólo mostramos inscripciones activas o asistidas en la lista superior;
  // las cancelled las omitimos (el socio puede re-inscribirse desde la agenda).
  const activeRegs = registrations.filter((r) => r.status !== 'cancelled')
  const myEventIds = new Set(activeRegs.map((r) => r.event_id))

  // Eventos futuros a los que el socio aún no está inscrito.
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const upcoming = allEvents
    .filter((e) => new Date(e.date) >= today && !myEventIds.has(e.id))
    .sort((a, b) => new Date(a.date) - new Date(b.date))

  return (
    <main className="member-home">
      <header className="member-home-nav">
        <div className="member-home-logo">AIKIKAN<span> /</span> EVENTOS</div>
        <button className="member-home-logout" onClick={onBack}>← Volver</button>
      </header>

      <section className="member-home-hero">
        <p className="member-home-eyebrow"><span className="slash">/</span> Eventos</p>
        <h1 className="member-home-title">Tu agenda</h1>
        <p className="member-home-lead">
          Inscripciones activas y próximos seminarios a los que puedes apuntarte.
        </p>
      </section>

      <div className="member-events-wrap">
        {loading && <p className="dojos-empty">/ Cargando…</p>}
        {error && <p className="dojos-empty" style={{ color: 'var(--accent)' }}>/ Error: {error}</p>}

        {!loading && !error && (
          <>
            <section className="member-events-block">
              <div className="member-events-eyebrow"><span className="slash">/</span> Mis inscripciones</div>
              <h2 className="member-events-title">Eventos a los que asistes</h2>

              {activeRegs.length === 0 ? (
                <p className="dojos-empty">/ Aún no estás inscrito a ningún evento.</p>
              ) : (
                <div className="member-events-list">
                  {activeRegs.map((r) => {
                    const { month, day, year } = eventDateParts(r.event_date)
                    const isPast = new Date(r.event_date) < today
                    return (
                      <div key={r.id} className="member-event-row">
                        <div className="member-event-date">
                          <span className="member-event-day">{day}</span>
                          <span className="member-event-month">{month}</span>
                          <span className="member-event-year">{year}</span>
                        </div>
                        <div className="member-event-body">
                          <p className="member-event-name">{r.event_name}</p>
                          {r.event_location && <p className="member-event-loc">{r.event_location}</p>}
                          <p className="member-event-status">/ {statusLabel(r.status)}</p>
                        </div>
                        {!isPast && r.status === 'registered' && (
                          <button
                            className="member-event-cancel"
                            onClick={() => cancel(r.event_id)}
                            disabled={busy[r.event_id] === 'cancel'}
                            title="Cancelar inscripción"
                          >
                            {busy[r.event_id] === 'cancel' ? 'Cancelando…' : 'Cancelar'}
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </section>

            <section className="member-events-block">
              <div className="member-events-eyebrow"><span className="slash">/</span> Agenda</div>
              <h2 className="member-events-title">Próximos eventos</h2>

              {upcoming.length === 0 ? (
                <p className="dojos-empty">/ No hay nuevos eventos en agenda.</p>
              ) : (
                <div className="member-events-list">
                  {upcoming.map((e) => {
                    const { month, day, year } = eventDateParts(e.date)
                    return (
                      <div key={e.id} className="member-event-row">
                        <div className="member-event-date">
                          <span className="member-event-day">{day}</span>
                          <span className="member-event-month">{month}</span>
                          <span className="member-event-year">{year}</span>
                        </div>
                        <div className="member-event-body">
                          <p className="member-event-name">{e.name}</p>
                          {e.location && <p className="member-event-loc">{e.location}</p>}
                        </div>
                        <button
                          className="member-event-register"
                          onClick={() => register(e.id)}
                          disabled={busy[e.id] === 'register'}
                        >
                          {busy[e.id] === 'register' ? 'Inscribiendo…' : '+ Inscribirme'}
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  )
}
