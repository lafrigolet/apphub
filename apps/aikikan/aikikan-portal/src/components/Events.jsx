import { useEffect, useState } from 'react'

// Landing pública — lista los próximos eventos. Consume el endpoint
// público de platform-appointments:
//   GET /api/services/sessions/upcoming?appId=…&tenantId=…&kind=event
//
// El tenant lo resolvemos por subdomain antes de pedir las sesiones —
// patrón portable a tenant-console multi-tenant. La gestión de eventos
// (crear/borrar) vivía aquí pero pasó a la consola admin de
// tenant-console-ui (módulo `events`); este componente queda como
// vista pública de sólo lectura.
const APP_ID = 'aikikan'
const MONTHS_ES = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC']

function formatDate(iso) {
  const d = new Date(iso)
  return { month: MONTHS_ES[d.getMonth()], year: String(d.getFullYear()) }
}

async function resolveTenantId(subdomain) {
  const res = await fetch(`/api/tenants/tenants/by-subdomain/${encodeURIComponent(subdomain)}`)
  if (!res.ok) throw new Error(`No se pudo resolver tenant ${subdomain}`)
  const j = await res.json()
  return j.tenantId ?? j.data?.tenantId
}

export default function Events() {
  const [sessions, setSessions] = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    ;(async () => {
      try {
        const tenantId = await resolveTenantId(APP_ID)
        const url = `/api/services/sessions/upcoming?appId=${APP_ID}&tenantId=${encodeURIComponent(tenantId)}&kind=event`
        const res = await fetch(url)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = await res.json()
        if (cancelled) return
        const rows = json?.data ?? []
        // Adaptamos la shape de session a la que pinta la UI legacy
        // (name + location + date) para no tocar el JSX más abajo.
        setSessions(rows.map((s) => ({
          id:       s.id,
          name:     s.session_description || s.service_name,
          location: s.location,
          starts_at: s.starts_at,
        })))
      } catch (err) {
        if (!cancelled) setError(err.message ?? 'Error')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  return (
    <section id="eventos">
      <div className="section-label reveal"><span className="slash">/</span> Próximos Eventos</div>
      <h2 className="section-title reveal">AGENDA<br />2025–2026</h2>

      {loading && <p className="dojos-empty">/ Cargando…</p>}
      {error   && <p className="dojos-empty" style={{ color: 'var(--accent)' }}>/ Error: {error}</p>}

      {!loading && !error && (
        <div className="events-list">
          {sessions.map((e) => {
            const { month, year } = formatDate(e.starts_at)
            return (
              <div key={e.id} className="event-row reveal">
                <div className="event-date">{month}<small>{year}</small></div>
                <div>
                  <p className="event-name">{e.name}</p>
                  <p className="event-loc">{e.location}</p>
                </div>
                <span className="event-arrow">→</span>
              </div>
            )
          })}
          {sessions.length === 0 && <p className="dojos-empty">/ Sin eventos en agenda.</p>}
        </div>
      )}

      <div style={{ marginTop: '2.5rem' }} className="reveal">
        <a href="https://www.aikikan.es/events" className="btn-outline"><span className="slash">/</span> Ver todos los eventos</a>
      </div>
    </section>
  )
}
