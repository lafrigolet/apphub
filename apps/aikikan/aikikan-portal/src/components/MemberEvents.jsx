import { useEffect, useState } from 'react'
import { getAccessToken, getIdentity } from '../lib/auth.js'

// Inscripciones del socio. Tras el cutover Fase 2 consume directamente
// los módulos de platform-appointments:
//
//   GET    /api/services/sessions/upcoming?appId=&tenantId=&kind=event  (público)
//   GET    /api/bookings/?clientUserId=<me>                              (mis inscripciones)
//   POST   /api/bookings/  { sessionId }                                  (inscribirme)
//   POST   /api/bookings/:id/cancel                                       (cancelar)
//
// Los eventos legacy de app_aikikan.events fueron migrados a sessions
// en la migration 0009; este componente ya no toca aikikan-server.
const APP_ID = 'aikikan'

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

async function resolveTenantId() {
  const json = await api('GET', `/api/tenants/tenants/by-subdomain/${APP_ID}`)
  return json.tenantId ?? json.data?.tenantId
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
  if (status === 'completed')   return 'Asistido'
  if (status === 'cancelled')   return 'Cancelada'
  if (status === 'confirmed')   return 'Inscrito'
  if (status === 'reminded')    return 'Inscrito'
  if (status === 'checked_in')  return 'Hecho check-in'
  return status
}

export default function MemberEvents({ onBack }) {
  // Inscripciones del socio (bookings con session_id) + agenda pública
  // de sessions (para inscribirse a las que aún no estás apuntado).
  const [bookings, setBookings] = useState([])
  const [sessions, setSessions] = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)
  const [busy, setBusy]         = useState({})   // { [id]: 'register'|'cancel' }

  const identity = getIdentity()

  function load() {
    if (!identity?.userId) { setError('No autenticado'); setLoading(false); return }
    setLoading(true); setError(null)
    ;(async () => {
      try {
        const tenantId = await resolveTenantId()
        const [myBookingsRaw, upcoming] = await Promise.all([
          api('GET', `/api/bookings/?clientUserId=${encodeURIComponent(identity.userId)}`),
          api('GET', `/api/services/sessions/upcoming?appId=${APP_ID}&tenantId=${encodeURIComponent(tenantId)}&kind=event`),
        ])
        // bookings/ devuelve array plano. Filtramos sólo las que tienen
        // session_id (las del flujo evento; las clásicas las omitimos).
        const myBookings = (Array.isArray(myBookingsRaw) ? myBookingsRaw : []).filter((b) => b.session_id)
        setBookings(myBookings)
        const upcomingRows = upcoming?.data ?? []
        setSessions(upcomingRows)
      } catch (err) { setError(err.message ?? 'Error') }
      finally { setLoading(false) }
    })()
  }
  useEffect(load, [])

  async function register(sessionId) {
    setBusy((b) => ({ ...b, [sessionId]: 'register' }))
    try { await api('POST', '/api/bookings/', { sessionId }); load() }
    catch (err) { alert(err.message ?? 'Error al inscribirse') }
    finally { setBusy((b) => { const n = { ...b }; delete n[sessionId]; return n }) }
  }

  async function cancel(bookingId) {
    if (!confirm('¿Cancelar la inscripción a este evento?')) return
    setBusy((b) => ({ ...b, [bookingId]: 'cancel' }))
    try { await api('POST', `/api/bookings/${bookingId}/cancel`); load() }
    catch (err) { alert(err.message ?? 'Error al cancelar') }
    finally { setBusy((b) => { const n = { ...b }; delete n[bookingId]; return n }) }
  }

  // Inscripciones activas (excluye cancelled / no_show / rescheduled).
  const activeBookings = bookings.filter((b) => !['cancelled', 'no_show', 'rescheduled'].includes(b.status))
  const mySessionIds = new Set(activeBookings.map((b) => b.session_id))

  // Sessions futuras a las que el socio aún no se ha inscrito.
  const upcoming = sessions.filter((s) => !mySessionIds.has(s.id))

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

              {activeBookings.length === 0 ? (
                <p className="dojos-empty">/ Aún no estás inscrito a ningún evento.</p>
              ) : (
                <div className="member-events-list">
                  {activeBookings.map((b) => {
                    const { month, day, year } = eventDateParts(b.starts_at)
                    const isPast = new Date(b.starts_at) < new Date()
                    return (
                      <div key={b.id} className="member-event-row">
                        <div className="member-event-date">
                          <span className="member-event-day">{day}</span>
                          <span className="member-event-month">{month}</span>
                          <span className="member-event-year">{year}</span>
                        </div>
                        <div className="member-event-body">
                          <p className="member-event-name">{b.notes || 'Evento'}</p>
                          <p className="member-event-status">/ {statusLabel(b.status)}</p>
                        </div>
                        {!isPast && b.status === 'confirmed' && (
                          <button
                            className="member-event-cancel"
                            onClick={() => cancel(b.id)}
                            disabled={busy[b.id] === 'cancel'}
                            title="Cancelar inscripción"
                          >
                            {busy[b.id] === 'cancel' ? 'Cancelando…' : 'Cancelar'}
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
                  {upcoming.map((s) => {
                    const { month, day, year } = eventDateParts(s.starts_at)
                    return (
                      <div key={s.id} className="member-event-row">
                        <div className="member-event-date">
                          <span className="member-event-day">{day}</span>
                          <span className="member-event-month">{month}</span>
                          <span className="member-event-year">{year}</span>
                        </div>
                        <div className="member-event-body">
                          <p className="member-event-name">{s.session_description || s.service_name}</p>
                          {s.location && <p className="member-event-loc">{s.location}</p>}
                        </div>
                        <button
                          className="member-event-register"
                          onClick={() => register(s.id)}
                          disabled={busy[s.id] === 'register'}
                        >
                          {busy[s.id] === 'register' ? 'Inscribiendo…' : '+ Inscribirme'}
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
