import { useEffect, useState } from 'react'

const APP_ID = 'aikikan'
const MONTHS_ES = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC']

function formatDate(iso) {
  const d = new Date(iso)
  return { month: MONTHS_ES[d.getMonth()], year: String(d.getFullYear()) }
}

async function resolveTenantId(subdomain) {
  const res = await fetch(`/api/tenants/tenants/by-subdomain/${encodeURIComponent(subdomain)}`)
  if (!res.ok) return null
  const j = await res.json()
  return j.tenantId ?? j.data?.tenantId
}

export default function Hero() {
  // Columna derecha del Hero — lista resumida de próximas convocatorias.
  // Tras el cutover Fase 2 consume el endpoint público de sessions
  // (`/api/services/sessions/upcoming`). El CRUD admin se hace ahora
  // desde la consola embebida (tenant-console-ui módulo events).
  const [events, setEvents] = useState([])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const tenantId = await resolveTenantId(APP_ID)
        if (!tenantId) return
        const res = await fetch(`/api/services/sessions/upcoming?appId=${APP_ID}&tenantId=${encodeURIComponent(tenantId)}&kind=event`)
        if (!res.ok) return
        const j = await res.json()
        if (cancelled) return
        const rows = j?.data ?? []
        setEvents(rows.map((s) => ({
          id: s.id,
          date: s.starts_at,
          name: s.session_description || s.service_name,
          location: s.location,
        })))
      } catch { /* swallow — hero events are non-critical */ }
    })()
    return () => { cancelled = true }
  }, [])

  return (
    <section id="hero">
      <div className="hero-bg-circle"></div>
      <div className="hero-glow"></div>
      <div className="hero-grid">

        <div className="hero-left">
          <p className="hero-eyebrow"><span className="slash">/</span> Asociación Nacional · Aikido</p>
          <h1 className="hero-title">AIKI<span className="accent">KAN</span>ESPAÑA</h1>
          <blockquote className="hero-quote">
            "En aikido no hay formas ni modelos. Los movimientos naturales son los movimientos del aikido. Su profundidad es insondable e inagotable."
            <cite>/ O'SENSEI MORIHEI UESHIBA</cite>
          </blockquote>
          <div className="hero-meta">
            <div><div className="hero-stat-num">46+</div><div className="hero-stat-label">Dojos</div></div>
            <div><div className="hero-stat-num">IAF</div><div className="hero-stat-label">Afiliación</div></div>
            <div><div className="hero-stat-num">EAF</div><div className="hero-stat-label">Europea</div></div>
          </div>
        </div>

        <div className="hero-video-col">
          <div className="hero-video-frame">
            <video autoPlay muted loop playsInline>
              <source src="/hero.mp4" type="video/mp4" />
            </video>
            <div className="hero-video-overlay"></div>
          </div>
        </div>

        <div className="hero-events-col">
          <div className="section-label" style={{ marginBottom: '1rem' }}><span className="slash">/</span> Próximos Eventos</div>
          <div className="events-list" style={{ marginTop: 0 }}>
            {events.slice(0, 4).map((e) => {
              const { month, year } = formatDate(e.date)
              return (
                <div key={e.id} className="event-row">
                  <div className="event-date">{month}<small>{year}</small></div>
                  <div>
                    <p className="event-name">{e.name}</p>
                    <p className="event-loc">{e.location}</p>
                  </div>
                  <span className="event-arrow">→</span>
                </div>
              )
            })}
          </div>
          <a href="#eventos" className="hero-event-more"><span className="slash">/</span> Ver agenda completa</a>
        </div>
      </div>
    </section>
  )
}
