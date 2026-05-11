import { useEffect, useState } from 'react'
import { useApp } from '../../../shell/lib/context'
import { api } from '../../../shell/lib/api'
import ConfirmDialog from '../../../shell/lib/ConfirmDialog.jsx'

// Admin de eventos tras el cutover Fase 2. Los eventos ya no viven en
// aikikan-server; son `service_sessions` de un service kind='event' en
// platform-appointments. Esta vista:
//   1) Localiza (o crea) un service ancla "eventos" para el tenant.
//   2) Lista sus sesiones futuras y pasadas.
//   3) Permite crear nueva sesión, cancelar (soft), y ver inscritos.
//
// Endpoints consumidos:
//   GET    /api/services?onlyActive=true
//   POST   /api/services/                                    (auto-bootstrap del service ancla)
//   GET    /api/services/:id/sessions
//   POST   /api/services/:id/sessions
//   DELETE /api/services/sessions/:sessionId                 (soft cancel)
//   GET    /api/bookings?sessionId=:id                       (inscritos por sesión)
const ANCHOR_CODE = 'eventos'

async function ensureAnchorService() {
  // Buscamos un service kind='event' del tenant; si no existe creamos uno
  // con el code ANCHOR_CODE. Resilient: si hay varios kind='event' tomamos
  // el primero — el admin puede tener servicios distintos (seminario,
  // examen, taller) y querrá un selector para futuras versiones.
  const list = await api.get('/api/services/?onlyActive=true')
  const events = (Array.isArray(list) ? list : []).filter((s) => s.kind === 'event')
  if (events.length > 0) return events[0]
  return api.post('/api/services/', {
    code:            ANCHOR_CODE,
    name:            'Eventos',
    description:     'Seminarios, exámenes y cursos abiertos.',
    durationMinutes: 60,
    capacity:        200,
    kind:            'event',
    publicCatalog:   true,
    priceCents:      0,
    currency:        'EUR',
  })
}

function fmtDateTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es-ES', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function EventsAdmin() {
  const { toast } = useApp()
  const [anchor, setAnchor]   = useState(null)
  const [sessions, setSessions] = useState([])
  const [loading, setLoad]    = useState(true)
  const [error, setError]     = useState(null)
  const [open, setOpen]       = useState(false)
  const [pendingCancel, setPendingCancel] = useState(null)
  const [viewing, setViewing] = useState(null)   // session whose attendees we're viewing

  function load() {
    setLoad(true); setError(null)
    ensureAnchorService()
      .then(async (svc) => {
        setAnchor(svc)
        const res = await api.get(`/api/services/${svc.id}/sessions?includeCancelled=true`)
        setSessions(res?.data ?? [])
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoad(false))
  }
  useEffect(load, [])

  async function confirmCancel() {
    if (!pendingCancel) return
    try {
      await api.delete(`/api/services/sessions/${pendingCancel.id}`)
      toast?.('Convocatoria cancelada')
      load()
    } catch (e) { toast?.(e.message, 'danger') }
    finally { setPendingCancel(null) }
  }

  if (loading) return <div className="p-10 text-center text-ink3">Cargando…</div>
  if (error)   return <div className="p-10 text-center text-danger">Error: {error}</div>

  // Las sesiones se ordenan: scheduled futuras primero, luego pasadas / canceladas.
  const now = new Date()
  const sorted = [...sessions].sort((a, b) => {
    const aFuture = new Date(a.starts_at) >= now && a.status === 'scheduled'
    const bFuture = new Date(b.starts_at) >= now && b.status === 'scheduled'
    if (aFuture !== bFuture) return aFuture ? -1 : 1
    return new Date(a.starts_at) - new Date(b.starts_at)
  })

  return (
    <div className="p-8 max-w-5xl">
      <div className="flex items-start justify-between gap-6 mb-8">
        <div>
          <div className="text-[12px] uppercase tracking-[0.18em] text-ink3 mb-2">Comercial</div>
          <h1 className="font-display text-[44px] leading-none tracking-tight">
            <span className="italic font-normal">Eventos</span>
          </h1>
          <p className="text-ink3 mt-3 max-w-2xl text-[14px]">
            Convocatorias publicadas en el landing. Las inscripciones se
            gestionan vía <span className="font-mono text-[12px]">bookings</span> de
            la plataforma — la capacidad se valida automáticamente en cada alta.
          </p>
        </div>
        <button onClick={() => setOpen(true)} className="px-4 py-2 rounded-md bg-ink text-paper text-[13px] font-medium">
          + Nueva convocatoria
        </button>
      </div>

      {sorted.length === 0 ? (
        <div className="border border-line bg-paper2 rounded-xl p-10 text-center text-ink3">
          Sin convocatorias programadas.
        </div>
      ) : (
        <div className="bg-white border border-line rounded-xl shadow-card overflow-hidden">
          <table className="w-full text-[13.5px]">
            <thead className="bg-paper2 text-[11px] uppercase tracking-[0.14em] text-ink3">
              <tr>
                <th className="text-left px-4 py-2 font-normal">Inicio</th>
                <th className="text-left px-4 py-2 font-normal">Título</th>
                <th className="text-left px-4 py-2 font-normal">Ubicación</th>
                <th className="text-left px-4 py-2 font-normal">Aforo</th>
                <th className="text-left px-4 py-2 font-normal">Estado</th>
                <th className="text-right px-4 py-2 font-normal w-40">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((s) => (
                <tr key={s.id} className={`border-t border-line hover:bg-paper2 ${s.status === 'cancelled' ? 'opacity-50' : ''}`}>
                  <td className="px-4 py-2.5 font-mono text-[12px]">{fmtDateTime(s.starts_at)}</td>
                  <td className="px-4 py-2.5">{s.description ?? <em className="text-ink3">—</em>}</td>
                  <td className="px-4 py-2.5 text-ink2">{s.location ?? <em className="text-ink3">—</em>}</td>
                  <td className="px-4 py-2.5 text-ink2">{s.capacity ?? anchor?.capacity ?? '—'}</td>
                  <td className="px-4 py-2.5">
                    <span className={`px-2 py-0.5 rounded text-[11px] font-mono ${
                      s.status === 'scheduled' ? 'bg-okbg text-ok'
                      : s.status === 'cancelled' ? 'bg-dangerbg text-danger'
                      : 'bg-paper2 text-ink3'
                    }`}>{s.status}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right space-x-3">
                    <button onClick={() => setViewing(s)} className="text-[12px] text-ink2 hover:underline">Inscritos</button>
                    {s.status === 'scheduled' && (
                      <button onClick={() => setPendingCancel(s)} className="text-[12px] text-danger hover:underline">Cancelar</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && anchor && (
        <NewSessionModal
          anchor={anchor}
          onClose={() => setOpen(false)}
          onCreated={() => { setOpen(false); toast?.('Convocatoria creada'); load() }}
        />
      )}
      {pendingCancel && (
        <ConfirmDialog
          title="Cancelar convocatoria"
          message={`¿Cancelar "${pendingCancel.description ?? 'esta convocatoria'}"? Las inscripciones ya hechas quedarán colgantes.`}
          confirmLabel="Cancelar convocatoria"
          onConfirm={confirmCancel}
          onClose={() => setPendingCancel(null)}
        />
      )}
      {viewing && (
        <AttendeesModal session={viewing} onClose={() => setViewing(null)} />
      )}
    </div>
  )
}

function NewSessionModal({ anchor, onClose, onCreated }) {
  const [date, setDate]       = useState('')
  const [startTime, setSt]    = useState('09:00')
  const [endTime, setEt]      = useState('18:00')
  const [description, setDes] = useState('')
  const [location, setLoc]    = useState('')
  const [capacity, setCap]    = useState('')
  const [busy, setBusy]       = useState(false)
  const [error, setError]     = useState(null)

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
      await api.post(`/api/services/${anchor.id}/sessions`, {
        startsAt, endsAt,
        description: description || undefined,
        location:    location    || undefined,
        capacity:    capacity ? Number(capacity) : undefined,
      })
      onCreated()
    } catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30" onClick={onClose}>
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-pop overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="p-6 border-b border-line">
          <div className="font-display text-[22px]">Nueva convocatoria</div>
          <div className="text-[12px] text-ink3 mt-1">Service: <span className="font-mono">{anchor.code}</span></div>
        </div>
        <form className="p-6 space-y-4" onSubmit={submit}>
          <div>
            <div className="label mb-1.5">Fecha</div>
            <input type="date" required className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="label mb-1.5">Hora inicio</div>
              <input type="time" required className="input" value={startTime} onChange={(e) => setSt(e.target.value)} />
            </div>
            <div>
              <div className="label mb-1.5">Hora fin</div>
              <input type="time" required className="input" value={endTime} onChange={(e) => setEt(e.target.value)} />
            </div>
          </div>
          <div>
            <div className="label mb-1.5">Título / descripción</div>
            <input type="text" maxLength={256} className="input" value={description} onChange={(e) => setDes(e.target.value)} placeholder="Seminario de Primavera con Tiki Shewan" />
          </div>
          <div>
            <div className="label mb-1.5">Ubicación (opcional)</div>
            <input type="text" maxLength={256} className="input" value={location} onChange={(e) => setLoc(e.target.value)} placeholder="Polideportivo · Madrid" />
          </div>
          <div>
            <div className="label mb-1.5">Aforo (opcional, override del service)</div>
            <input type="number" min="1" className="input" value={capacity} onChange={(e) => setCap(e.target.value)} placeholder={`Default: ${anchor.capacity ?? 1}`} />
          </div>
          {error && <div className="bg-dangerbg border border-line rounded-lg p-3 text-[12.5px] text-danger">{error}</div>}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn btn-ghost" disabled={busy}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={busy || !date}>
              {busy ? 'Guardando…' : 'Crear'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function AttendeesModal({ session, onClose }) {
  const [bookings, setBookings] = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    setLoading(true); setError(null)
    api.get(`/api/bookings/?sessionId=${session.id}`)
      .then((arr) => setBookings(Array.isArray(arr) ? arr : []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [session.id])

  const active = bookings.filter((b) => !['cancelled', 'no_show', 'rescheduled'].includes(b.status))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30" onClick={onClose}>
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-pop overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="p-6 border-b border-line">
          <div className="font-display text-[22px]">Inscritos</div>
          <div className="text-[12px] text-ink3 mt-1">
            {session.description ?? 'Convocatoria'} · {fmtDateTime(session.starts_at)} ·
            {' '}{active.length} inscritos
          </div>
        </div>
        <div className="p-6 max-h-[60vh] overflow-y-auto">
          {loading && <div className="text-ink3">Cargando…</div>}
          {error && <div className="text-danger text-[13px]">{error}</div>}
          {!loading && !error && active.length === 0 && (
            <div className="text-ink3 text-center py-6">Aún no hay inscritos.</div>
          )}
          {!loading && !error && active.length > 0 && (
            <table className="w-full text-[13px]">
              <thead className="text-[11px] uppercase tracking-[0.14em] text-ink3">
                <tr>
                  <th className="text-left py-2 font-normal">user_id</th>
                  <th className="text-left py-2 font-normal">Nombre</th>
                  <th className="text-left py-2 font-normal">Email</th>
                  <th className="text-left py-2 font-normal">Estado</th>
                  <th className="text-left py-2 font-normal">Inscrito</th>
                </tr>
              </thead>
              <tbody>
                {active.map((b) => (
                  <tr key={b.id} className="border-t border-line">
                    <td className="py-2 font-mono text-[11px]">{b.client_user_id.slice(0, 8)}…</td>
                    <td className="py-2">{b.client_name ?? <em className="text-ink3">—</em>}</td>
                    <td className="py-2 text-ink2">{b.client_email ?? <em className="text-ink3">—</em>}</td>
                    <td className="py-2"><span className="font-mono text-[11px]">{b.status}</span></td>
                    <td className="py-2 text-ink3 text-[12px]">{fmtDateTime(b.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="p-4 border-t border-line flex justify-end">
          <button onClick={onClose} className="btn btn-ghost">Cerrar</button>
        </div>
      </div>
    </div>
  )
}
