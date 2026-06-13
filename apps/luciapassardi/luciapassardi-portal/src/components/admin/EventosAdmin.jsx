import { useEffect, useState } from 'react'
import AdminBar from './AdminBar.jsx'
import { listEventosAdmin, crearEvento, borrarEvento } from '../../lib/studio.js'

const fmt = (iso) => {
  const d = new Date(iso)
  return d.toLocaleString('es-ES', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// Sección de backoffice para gestionar los "próximos eventos" (service_sessions
// del servicio 'eventos'). CRUD real → lo que aquí guardes aparece en el hero.
export default function EventosAdmin() {
  const [eventos, setEventos] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)

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

  async function onCrear(e) {
    e.preventDefault()
    setErr('')
    if (!titulo || !inicio) { setErr('Título y fecha/hora son obligatorios'); return }
    setSaving(true)
    try {
      const startsAt = new Date(inicio).toISOString()
      const endsAt = new Date(new Date(inicio).getTime() + Number(duracion) * 3600_000).toISOString()
      await crearEvento({ titulo, startsAt, endsAt, location: ubicacion, capacity: aforo })
      setTitulo(''); setInicio(''); setDuracion(2); setUbicacion(''); setAforo(20)
      reload()
    } catch (e2) {
      setErr(e2.message ?? 'No se pudo crear el evento')
    } finally {
      setSaving(false)
    }
  }

  async function onBorrar(id) {
    if (!window.confirm('¿Eliminar este evento?')) return
    try { await borrarEvento(id); reload() } catch (e) { setErr(e.message) }
  }

  return (
    <div className="min-h-screen bg-piedra text-tinta">
      <AdminBar active="eventos" />
      <div className="max-w-4xl mx-auto px-5 py-10">
        <p className="eyebrow">Backoffice · Próximos eventos</p>
        <h1 className="display text-4xl sm:text-5xl mt-2 mb-2">Eventos</h1>
        <p className="text-tinta/60 mb-8">Lo que publiques aquí aparece en el hero de la web (sección “Próximos eventos”).</p>

        {/* Alta */}
        <form onSubmit={onCrear} className="card-zen p-6 mb-8 grid sm:grid-cols-2 gap-4">
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
            <button type="submit" disabled={saving} className="btn-zen btn-fill">{saving ? 'Guardando…' : 'Añadir evento'}</button>
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
              <li key={s.id} className="card-zen p-5 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-semibold text-tinta">{s.description || s.service_name || 'Evento'}</p>
                  <p className="text-sm text-tinta/55">{fmt(s.starts_at)}{s.location ? ` · ${s.location}` : ''}{s.capacity ? ` · ${s.capacity} plazas` : ''}</p>
                </div>
                <button onClick={() => onBorrar(s.id)} className="btn-zen btn-outline !py-2 !px-4 text-[13px] shrink-0">Eliminar</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
