import { useEffect, useState } from 'react'
import { getAccessToken, getIdentity, isAdminRole } from '../lib/auth.js'
import EventModal, { deleteEvent } from './EventModal.jsx'

// Landing pública — lista los próximos eventos. Consume el endpoint
// público de platform-appointments:
//   GET /api/services/sessions/upcoming?appId=…&tenantId=…&kind=event
//
// El tenant lo resolvemos por subdomain antes de pedir las sesiones —
// patrón portable a tenant-console multi-tenant.
//
// Cuando el usuario logueado tiene rol admin/owner/staff/super_admin
// activamos controles inline: botón "+" para crear evento, "pen" para
// editar y "trash" para borrar (soft-cancel). En modo admin el listado
// se carga vía `/api/services/:anchorId/sessions` (autenticado) para
// tener IDs y los campos completos en vez del DTO público recortado.
const APP_ID = 'aikikan'
const ANCHOR_CODE = 'eventos'
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

function authFetch(url, opts = {}) {
  const token = getAccessToken()
  return fetch(url, {
    ...opts,
    headers: {
      ...(opts.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
}

// Encuentra (o crea) el service ancla 'eventos' del tenant. Misma
// estrategia que la consola admin (tenant-console-ui/events/EventsAdmin).
async function ensureAnchorService() {
  const listRes = await authFetch('/api/services/?onlyActive=true')
  const listJson = await listRes.json().catch(() => ({}))
  if (!listRes.ok) throw new Error(listJson.error?.message ?? listRes.statusText)
  const arr = Array.isArray(listJson) ? listJson : listJson?.data ?? []
  const events = arr.filter((s) => s.kind === 'event')
  if (events.length > 0) return events[0]
  const res = await authFetch('/api/services/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code:            ANCHOR_CODE,
      name:            'Eventos',
      description:     'Seminarios, exámenes y cursos abiertos.',
      durationMinutes: 60,
      capacity:        200,
      kind:            'event',
      publicCatalog:   true,
      priceCents:      0,
      currency:        'EUR',
    }),
  })
  const j = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(j.error?.message ?? res.statusText)
  return j.data ?? j
}

export default function Events() {
  const identity = getIdentity()
  // Sigue el patrón de Videos/Dojos: con que el rol sea admin/owner/staff
  // basta. El JWT del portal aikikan ya garantiza app_id='aikikan'.
  const isAdmin = !!(identity && isAdminRole(identity.role))

  const [sessions, setSessions] = useState([])
  const [anchor, setAnchor]     = useState(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)
  const [modal, setModal]       = useState(null)   // null | 'new' | session raw (edit)

  function load() {
    setLoading(true); setError(null)
    ;(async () => {
      try {
        if (isAdmin) {
          // El anchor se resuelve "best-effort": si falla NO bloqueamos
          // el botón "+", que sigue visible para que el admin pueda
          // reintentar abriendo el modal (la creación lo resolverá de
          // nuevo bajo demanda).
          let svc = null
          try {
            svc = await ensureAnchorService()
            setAnchor(svc)
          } catch (err) {
            console.warn('[events] ensureAnchorService falló', err)
          }
          if (svc) {
            const res = await authFetch(`/api/services/${svc.id}/sessions`)
            const json = await res.json().catch(() => ({}))
            if (!res.ok) throw new Error(json.error?.message ?? res.statusText)
            const rows = (json?.data ?? []).filter((s) => s.status === 'scheduled')
            setSessions(rows.map((s) => ({
              id:        s.id,
              name:      s.description || svc.name,
              location:  s.location,
              starts_at: s.starts_at,
              _raw:      s,
            })))
          } else {
            setSessions([])
          }
        } else {
          const tenantId = await resolveTenantId(APP_ID)
          const url = `/api/services/sessions/upcoming?appId=${APP_ID}&tenantId=${encodeURIComponent(tenantId)}&kind=event`
          const res = await fetch(url)
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const json = await res.json()
          const rows = json?.data ?? []
          setSessions(rows.map((s) => ({
            id:        s.id,
            name:      s.session_description || s.service_name,
            location:  s.location,
            starts_at: s.starts_at,
          })))
        }
      } catch (err) {
        setError(err.message ?? 'Error')
      } finally {
        setLoading(false)
      }
    })()
  }

  useEffect(load, [isAdmin])

  async function handleDelete(row) {
    const label = row._raw?.description || row.name || 'este evento'
    if (!confirm(`¿Borrar "${label}"? Las inscripciones ya hechas quedarán colgantes.`)) return
    try {
      await deleteEvent(row.id)
      load()
    } catch (err) {
      alert(`No se pudo borrar: ${err.message}`)
    }
  }

  // El botón "+" puede dispararse antes de que el anchor esté resuelto
  // (sobre todo en tenants vírgenes donde la lista está vacía). Si no
  // tenemos anchor aún, lo creamos al vuelo y abrimos el modal.
  async function openNew() {
    if (anchor) { setModal('new'); return }
    try {
      const svc = await ensureAnchorService()
      setAnchor(svc)
      setModal('new')
    } catch (err) {
      alert(`No se pudo preparar el evento: ${err.message}`)
    }
  }

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
              <div key={e.id} className="event-row">
                <div className="event-date">{month}<small>{year}</small></div>
                <div>
                  <p className="event-name">{e.name}</p>
                  <p className="event-loc">{e.location}</p>
                </div>
                {isAdmin ? (
                  <div className="event-actions">
                    <button
                      type="button"
                      className="event-edit"
                      title="Editar evento"
                      aria-label="Editar evento"
                      onClick={() => setModal(e._raw)}
                    >✎</button>
                    <button
                      type="button"
                      className="event-trash"
                      title="Borrar evento"
                      aria-label="Borrar evento"
                      onClick={() => handleDelete(e)}
                    >🗑</button>
                  </div>
                ) : (
                  <span className="event-arrow">→</span>
                )}
              </div>
            )
          })}
          {sessions.length === 0 && <p className="dojos-empty">/ Sin eventos en agenda.</p>}
        </div>
      )}

      {isAdmin && (
        <div style={{ marginTop: '2rem', textAlign: 'center' }} className="reveal">
          <button type="button" onClick={openNew} className="btn-outline">
            <span className="slash">/</span> + Añadir evento
          </button>
        </div>
      )}

      {modal && anchor && (
        <EventModal
          anchorServiceId={anchor.id}
          existing={modal === 'new' ? null : modal}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load() }}
        />
      )}
    </section>
  )
}
