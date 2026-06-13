import { useEffect, useState } from 'react'
import AdminBar from './AdminBar.jsx'
import { listEventosAdmin, crearEvento, editarEvento, borrarEvento } from '../../lib/studio.js'

const fmt = (iso) => {
  const d = new Date(iso)
  return d.toLocaleString('es-ES', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// Convierte un ISO a value de <input type="datetime-local"> (hora local).
const toLocalInput = (iso) => {
  const d = new Date(iso)
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16)
}

const Pencil = () => (
  <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" />
  </svg>
)
const X = () => (
  <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
)

// Sección de backoffice para gestionar los "próximos eventos" (service_sessions
// del servicio 'eventos'). CRUD real → lo que aquí guardes aparece en el hero.
export default function EventosAdmin() {
  const [eventos, setEventos] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)

  const [editId, setEditId] = useState(null)
  const [titulo, setTitulo] = useState('')
  const [inicio, setInicio] = useState('')      // datetime-local
  const [duracion, setDuracion] = useState(2)   // horas
  const [ubicacion, setUbicacion] = useState('')
  const [aforo, setAforo] = useState(20)

  function reload() {
    setLoading(true)
    listEventosAdmin()
      .then(setEventos)
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false))
  }
  useEffect(reload, [])

  function resetForm() {
    setEditId(null); setTitulo(''); setInicio(''); setDuracion(2); setUbicacion(''); setAforo(20); setErr('')
  }

  function startEdit(s) {
    setEditId(s.id)
    setTitulo(s.description || s.service_name || '')
    setInicio(toLocalInput(s.starts_at))
    const dur = s.ends_at ? (new Date(s.ends_at) - new Date(s.starts_at)) / 3600_000 : 2
    setDuracion(dur > 0 ? dur : 2)
    setUbicacion(s.location || '')
    setAforo(s.capacity || 20)
    setErr('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function onSubmit(e) {
    e.preventDefault()
    setErr('')
    if (!titulo || !inicio) { setErr('Título y fecha/hora son obligatorios'); return }
    setSaving(true)
    try {
      const startsAt = new Date(inicio).toISOString()
      const endsAt = new Date(new Date(inicio).getTime() + Number(duracion) * 3600_000).toISOString()
      if (editId) {
        await editarEvento(editId, { titulo, startsAt, endsAt, location: ubicacion, capacity: aforo })
      } else {
        await crearEvento({ titulo, startsAt, endsAt, location: ubicacion, capacity: aforo })
      }
      resetForm()
      reload()
    } catch (e2) {
      setErr(e2.message ?? 'No se pudo guardar el evento')
    } finally {
      setSaving(false)
    }
  }

  async function onBorrar(id) {
    if (!window.confirm('¿Eliminar este evento?')) return
    try { await borrarEvento(id); if (editId === id) resetForm(); reload() } catch (e) { setErr(e.message) }
  }

  return (
    <AdminBar active="eventos">
      <div className="max-w-4xl mx-auto px-5 py-10">
        <p className="eyebrow">Backoffice · Próximos eventos</p>
        <h1 className="display text-4xl sm:text-5xl mt-2 mb-2">Eventos</h1>
        <p className="text-tinta/60 mb-8">Lo que publiques aquí aparece en el hero de la web (sección “Próximos eventos”). Pulsa el lápiz para editar o la × para eliminar.</p>

        {/* Crear / editar */}
        <form onSubmit={onSubmit} className={`card-zen p-6 mb-8 grid sm:grid-cols-2 gap-4 ${editId ? 'ring-1 ring-teal-500/40' : ''}`}>
          <div className="sm:col-span-2 flex items-center justify-between">
            <span className="eyebrow">{editId ? 'Editar evento' : 'Nuevo evento'}</span>
            {editId && <button type="button" onClick={resetForm} className="text-sm text-tinta/55 hover:text-teal-600">Cancelar edición</button>}
          </div>
          <div className="sm:col-span-2">
            <label className="block text-[12px] uppercase tracking-widest text-tinta/45 font-semibold mb-1">Título</label>
            <input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Retiro de enero"
              className="w-full rounded-xl border border-tinta/15 bg-crema px-4 py-2.5 focus:outline-none focus:border-teal-500" />
          </div>
          <div>
            <label className="block text-[12px] uppercase tracking-widest text-tinta/45 font-semibold mb-1">Fecha y hora</label>
            <input type="datetime-local" value={inicio} onChange={(e) => setInicio(e.target.value)}
              className="w-full rounded-xl border border-tinta/15 bg-crema px-4 py-2.5 focus:outline-none focus:border-teal-500" />
          </div>
          <div>
            <label className="block text-[12px] uppercase tracking-widest text-tinta/45 font-semibold mb-1">Duración (horas)</label>
            <input type="number" min="1" step="0.5" value={duracion} onChange={(e) => setDuracion(e.target.value)}
              className="w-full rounded-xl border border-tinta/15 bg-crema px-4 py-2.5 focus:outline-none focus:border-teal-500" />
          </div>
          <div>
            <label className="block text-[12px] uppercase tracking-widest text-tinta/45 font-semibold mb-1">Ubicación</label>
            <input value={ubicacion} onChange={(e) => setUbicacion(e.target.value)} placeholder="Sierra de Madrid"
              className="w-full rounded-xl border border-tinta/15 bg-crema px-4 py-2.5 focus:outline-none focus:border-teal-500" />
          </div>
          <div>
            <label className="block text-[12px] uppercase tracking-widest text-tinta/45 font-semibold mb-1">Aforo</label>
            <input type="number" min="1" value={aforo} onChange={(e) => setAforo(e.target.value)}
              className="w-full rounded-xl border border-tinta/15 bg-crema px-4 py-2.5 focus:outline-none focus:border-teal-500" />
          </div>
          {err && <p className="sm:col-span-2 text-sm text-red-700 bg-red-500/10 rounded-lg px-3 py-2">{err}</p>}
          <div className="sm:col-span-2 flex justify-end">
            <button type="submit" disabled={saving} className="btn-zen btn-fill">
              {saving ? 'Guardando…' : editId ? 'Guardar cambios' : 'Añadir evento'}
            </button>
          </div>
        </form>

        {/* Lista */}
        {loading ? (
          <p className="text-tinta/50">Cargando…</p>
        ) : eventos.length === 0 ? (
          <p className="text-tinta/50 italic">Aún no hay eventos. Añade el primero arriba.</p>
        ) : (
          <ul className="space-y-3">
            {eventos.map((s) => (
              <li key={s.id} className={`card-zen p-5 flex items-center justify-between gap-4 ${editId === s.id ? 'ring-1 ring-teal-500/50' : ''}`}>
                <div className="min-w-0">
                  <p className="font-semibold text-tinta">{s.description || s.service_name || 'Evento'}</p>
                  <p className="text-sm text-tinta/55">{fmt(s.starts_at)}{s.location ? ` · ${s.location}` : ''}{s.capacity ? ` · ${s.capacity} plazas` : ''}</p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <button onClick={() => startEdit(s)} title="Editar" className="p-1.5 rounded text-tinta/40 hover:text-teal-600 hover:bg-teal-500/10"><Pencil /></button>
                  <button onClick={() => onBorrar(s.id)} title="Eliminar" className="p-1.5 rounded text-tinta/40 hover:text-red-700 hover:bg-red-500/10"><X /></button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AdminBar>
  )
}
