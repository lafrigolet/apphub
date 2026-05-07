import { useEffect, useState } from 'react'
import { useApp } from '../../../shell/lib/context'
import { api } from '../../../shell/lib/api'
import ConfirmDialog from '../../../shell/lib/ConfirmDialog.jsx'

// CRUD de eventos en el AdminShell. Fuente de datos:
//   GET    /api/aikikan/events  (público)
//   POST   /api/aikikan/events  (admin)
//   DELETE /api/aikikan/events/:id  (admin)
// Mismo endpoint que consume Events.jsx en la landing pública;
// sincroniza con ella tras cada mutación al recargar la lista.
export default function EventsAdmin() {
  const { toast } = useApp()
  const [items, setItems]   = useState([])
  const [loading, setLoad]  = useState(true)
  const [error, setError]   = useState(null)
  const [open, setOpen]     = useState(false)
  const [pendingDelete, setPendingDelete] = useState(null)

  function load() {
    setLoad(true); setError(null)
    api.get('/api/aikikan/events')
      .then((r) => setItems(Array.isArray(r) ? r : []))
      .catch((e) => setError(e.message))
      .finally(() => setLoad(false))
  }

  useEffect(load, [])

  async function confirmDelete() {
    if (!pendingDelete) return
    try { await api.delete(`/api/aikikan/events/${pendingDelete.id}`); toast?.('Evento eliminado'); load() }
    catch (e) { toast?.(e.message, 'danger') }
  }

  if (loading) return <div className="p-10 text-center text-ink3">Cargando…</div>
  if (error)   return <div className="p-10 text-center text-danger">Error: {error}</div>

  return (
    <div className="p-8 max-w-5xl">
      <div className="flex items-start justify-between gap-6 mb-8">
        <div>
          <div className="text-[12px] uppercase tracking-[0.18em] text-ink3 mb-2">Comercial</div>
          <h1 className="font-display text-[44px] leading-none tracking-tight">
            <span className="italic font-normal">Eventos</span>
          </h1>
          <p className="text-ink3 mt-3 max-w-2xl text-[14px]">
            Agenda pública del landing. Los cambios se publican en directo:
            visitantes y socios ven los eventos sin necesidad de despliegue.
          </p>
        </div>
        <button onClick={() => setOpen(true)} className="px-4 py-2 rounded-md bg-ink text-paper text-[13px] font-medium">
          + Nuevo evento
        </button>
      </div>

      {items.length === 0 ? (
        <div className="border border-line bg-paper2 rounded-xl p-10 text-center text-ink3">
          Sin eventos en la agenda.
        </div>
      ) : (
        <div className="bg-white border border-line rounded-xl shadow-card overflow-hidden">
          <table className="w-full text-[13.5px]">
            <thead className="bg-paper2 text-[11px] uppercase tracking-[0.14em] text-ink3">
              <tr>
                <th className="text-left px-4 py-2 font-normal">Fecha</th>
                <th className="text-left px-4 py-2 font-normal">Evento</th>
                <th className="text-left px-4 py-2 font-normal">Ubicación</th>
                <th className="text-right px-4 py-2 font-normal w-24">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {items.map((e) => (
                <tr key={e.id} className="border-t border-line hover:bg-paper2">
                  <td className="px-4 py-2.5 font-mono text-[12px]">{(e.date ?? '').slice(0, 10)}</td>
                  <td className="px-4 py-2.5">{e.name}</td>
                  <td className="px-4 py-2.5 text-ink2">{e.location ?? <em className="text-ink3">—</em>}</td>
                  <td className="px-4 py-2.5 text-right">
                    <button onClick={() => setPendingDelete(e)} className="text-[12px] text-danger hover:underline">Eliminar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <NewEventModal
          onClose={() => setOpen(false)}
          onCreated={() => { setOpen(false); toast?.('Evento creado'); load() }}
        />
      )}
      {pendingDelete && (
        <ConfirmDialog
          title="Eliminar evento"
          message={`¿Eliminar el evento "${pendingDelete.name}"? Esta acción no se puede deshacer.`}
          confirmLabel="Eliminar"
          onConfirm={confirmDelete}
          onClose={() => setPendingDelete(null)}
        />
      )}
    </div>
  )
}

function NewEventModal({ onClose, onCreated }) {
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
      await api.post('/api/aikikan/events', {
        date, name,
        ...(location ? { location } : {}),
      })
      onCreated()
    } catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30" onClick={onClose}>
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-pop overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="p-6 border-b border-line">
          <div className="font-display text-[22px]">Nuevo evento</div>
        </div>
        <form className="p-6 space-y-4" onSubmit={submit}>
          <div>
            <div className="label mb-1.5">Fecha</div>
            <input type="date" required className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <div className="label mb-1.5">Nombre del evento</div>
            <input type="text" required maxLength={256} className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Seminario Nacional de Primavera" />
          </div>
          <div>
            <div className="label mb-1.5">Ubicación (opcional)</div>
            <input type="text" maxLength={256} className="input" value={location} onChange={(e) => setLoc(e.target.value)} placeholder="/ Madrid · Convocatoria abierta" />
          </div>
          {error && <div className="bg-dangerbg border border-line rounded-lg p-3 text-[12.5px] text-danger">{error}</div>}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn btn-ghost" disabled={busy}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={busy || !date || !name.trim()}>
              {busy ? 'Guardando…' : 'Crear'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
