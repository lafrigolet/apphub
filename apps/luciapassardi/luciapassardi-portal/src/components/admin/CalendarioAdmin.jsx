import { useEffect, useState } from 'react'
import AdminBar from './AdminBar.jsx'
import { listClaseServices, listClasesAdmin, crearClase, editarClase, borrarSesion } from '../../lib/studio.js'

// Lun→Dom (getDay(): Dom=0). Mostramos la semana empezando en lunes.
const DOW = [
  { i: 1, n: 'Lunes', c: 'LUN' }, { i: 2, n: 'Martes', c: 'MAR' }, { i: 3, n: 'Miércoles', c: 'MIÉ' },
  { i: 4, n: 'Jueves', c: 'JUE' }, { i: 5, n: 'Viernes', c: 'VIE' }, { i: 6, n: 'Sábado', c: 'SÁB' },
  { i: 0, n: 'Domingo', c: 'DOM' },
]
const hhmm = (iso) => new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
const fechaCorta = (iso) => new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })
function toLocalInput(iso) {
  const d = new Date(iso); const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
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

export default function CalendarioAdmin() {
  const [servicios, setServicios] = useState([])
  const [clases, setClases] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)

  const [editId, setEditId] = useState(null) // null = crear; id = editar
  const [serviceId, setServiceId] = useState('')
  const [inicio, setInicio] = useState('')
  const [ubicacion, setUbicacion] = useState('')
  const [aforo, setAforo] = useState('')

  function reload() {
    setLoading(true)
    Promise.all([listClaseServices(), listClasesAdmin()])
      .then(([svc, cl]) => { setServicios(svc); setClases(cl) })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false))
  }
  useEffect(reload, [])

  function resetForm() {
    setEditId(null); setServiceId(''); setInicio(''); setUbicacion(''); setAforo(''); setErr('')
  }

  function startEdit(s) {
    const svc = servicios.find((x) => x.id === s.service_id) || servicios.find((x) => x.name === s.service_name)
    setEditId(s.id)
    setServiceId(svc?.id ?? '')
    setInicio(toLocalInput(s.starts_at))
    setUbicacion(s.location ?? '')
    setAforo(s.capacity ?? '')
    setErr('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function onSubmit(e) {
    e.preventDefault()
    setErr('')
    if (!serviceId || !inicio) { setErr('Tipo de clase y fecha/hora son obligatorios'); return }
    const svc = servicios.find((s) => s.id === serviceId)
    const dur = svc?.duration_minutes ?? 60
    setSaving(true)
    try {
      const startsAt = new Date(inicio).toISOString()
      const endsAt = new Date(new Date(inicio).getTime() + dur * 60_000).toISOString()
      if (editId) {
        await editarClase(editId, { startsAt, endsAt, location: ubicacion, capacity: aforo || svc?.capacity })
      } else {
        await crearClase({ serviceId, startsAt, endsAt, location: ubicacion, capacity: aforo || svc?.capacity })
      }
      resetForm()
      reload()
    } catch (e2) {
      setErr(e2.message ?? 'No se pudo guardar la clase')
    } finally {
      setSaving(false)
    }
  }

  async function onBorrar(id) {
    if (!window.confirm('¿Eliminar esta clase del calendario?')) return
    try {
      await borrarSesion(id)
      if (editId === id) resetForm()
      reload()
    } catch (e) { setErr(e.message) }
  }

  const byDay = (i) => clases.filter((s) => new Date(s.starts_at).getDay() === i)
    .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))

  return (
    <div className="min-h-screen bg-piedra text-tinta">
      <AdminBar active="calendario" />
      <div className="max-w-7xl mx-auto px-5 py-10">
        <p className="eyebrow">Backoffice · Calendario</p>
        <h1 className="display text-4xl sm:text-5xl mt-2 mb-2">Calendario de clases</h1>
        <p className="text-tinta/60 mb-8">Pulsa el lápiz para editar una clase (se carga en el formulario) o la × para eliminarla. Aparece en la sección “Horario” de la web.</p>

        {/* Formulario crear / editar */}
        <form onSubmit={onSubmit} className={`card-zen p-6 mb-10 grid sm:grid-cols-4 gap-4 ${editId ? 'ring-1 ring-teal-500/40' : ''}`}>
          <div className="sm:col-span-4 flex items-center justify-between">
            <span className="eyebrow">{editId ? 'Editar clase' : 'Nueva clase'}</span>
            {editId && <button type="button" onClick={resetForm} className="text-sm text-tinta/55 hover:text-teal-600">Cancelar edición</button>}
          </div>
          <div className="sm:col-span-2">
            <label className="block text-[12px] uppercase tracking-widest text-tinta/45 font-semibold mb-1">Tipo de clase</label>
            <select value={serviceId} onChange={(e) => setServiceId(e.target.value)} disabled={!!editId}
              className="w-full rounded-xl border border-tinta/15 bg-crema px-4 py-2.5 focus:outline-none focus:border-teal-500 disabled:opacity-60">
              <option value="">— Selecciona —</option>
              {servicios.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.duration_minutes}′)</option>)}
            </select>
            {editId && <p className="text-[11px] text-tinta/45 mt-1">El tipo no se cambia al editar; para cambiarlo, elimina y crea de nuevo.</p>}
          </div>
          <div>
            <label className="block text-[12px] uppercase tracking-widest text-tinta/45 font-semibold mb-1">Fecha y hora</label>
            <input type="datetime-local" value={inicio} onChange={(e) => setInicio(e.target.value)}
              className="w-full rounded-xl border border-tinta/15 bg-crema px-4 py-2.5 focus:outline-none focus:border-teal-500" />
          </div>
          <div>
            <label className="block text-[12px] uppercase tracking-widest text-tinta/45 font-semibold mb-1">Aforo</label>
            <input type="number" min="1" value={aforo} onChange={(e) => setAforo(e.target.value)} placeholder="(según la clase)"
              className="w-full rounded-xl border border-tinta/15 bg-crema px-4 py-2.5 focus:outline-none focus:border-teal-500" />
          </div>
          <div className="sm:col-span-4">
            <label className="block text-[12px] uppercase tracking-widest text-tinta/45 font-semibold mb-1">Ubicación</label>
            <input value={ubicacion} onChange={(e) => setUbicacion(e.target.value)} placeholder="Estudio Las Matas"
              className="w-full rounded-xl border border-tinta/15 bg-crema px-4 py-2.5 focus:outline-none focus:border-teal-500" />
          </div>
          {err && <p className="sm:col-span-4 text-sm text-red-700 bg-red-500/10 rounded-lg px-3 py-2">{err}</p>}
          <div className="sm:col-span-4 flex justify-end">
            <button type="submit" disabled={saving} className="btn-zen btn-fill">
              {saving ? 'Guardando…' : editId ? 'Guardar cambios' : 'Añadir clase'}
            </button>
          </div>
        </form>

        {/* Calendario semanal */}
        {loading ? (
          <p className="text-tinta/50">Cargando…</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3">
            {DOW.map((d) => {
              const items = byDay(d.i)
              return (
                <div key={d.i} className="flex flex-col">
                  <div className="flex items-baseline justify-between lg:justify-center gap-2 pb-2 mb-3 border-b-2 border-tinta/10">
                    <span className="display text-xl">{d.c}</span>
                    <span className="text-[11px] uppercase tracking-widest text-tinta/40 font-semibold lg:hidden">{d.n}</span>
                  </div>
                  <div className="flex flex-col gap-2.5">
                    {items.length === 0 && <p className="text-[13px] text-tinta/30 italic py-1">—</p>}
                    {items.map((s) => (
                      <div key={s.id} className={`card-zen p-3 group ${editId === s.id ? 'ring-1 ring-teal-500/50' : ''}`}>
                        <div className="flex items-center justify-between">
                          <span className="display text-lg text-teal-700">{hhmm(s.starts_at)}</span>
                          <div className="flex items-center gap-1">
                            <button onClick={() => startEdit(s)} title="Editar"
                              className="p-1 rounded text-tinta/40 hover:text-teal-600 hover:bg-teal-500/10"><Pencil /></button>
                            <button onClick={() => onBorrar(s.id)} title="Eliminar"
                              className="p-1 rounded text-tinta/40 hover:text-red-700 hover:bg-red-500/10"><X /></button>
                          </div>
                        </div>
                        <p className="font-semibold text-sm text-tinta leading-snug mt-0.5">{s.service_name || s.session_description || 'Clase'}</p>
                        <p className="text-[11px] text-tinta/50">{fechaCorta(s.starts_at)}{s.location ? ` · ${s.location}` : ''}</p>
                        {s.capacity ? <p className="text-[11px] text-tinta/40">{s.capacity} plazas</p> : null}
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
