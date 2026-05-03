import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../../../shell/lib/context'
import { api } from '../../../shell/lib/api'
import ConfirmDialog from '../../../shell/lib/ConfirmDialog.jsx'

// CRUD de dojos en la consola embebida. Mantiene buscador inline igual
// que la sección pública del landing (filtra por nombre / ciudad /
// provincia / sensei) — los controles de borrado actúan sobre los items
// filtrados.
export default function DojosAdmin() {
  const { toast } = useApp()
  const [items, setItems]   = useState([])
  const [loading, setLoad]  = useState(true)
  const [error, setError]   = useState(null)
  const [query, setQuery]   = useState('')
  const [open, setOpen]     = useState(false)
  const [pendingDelete, setPendingDelete] = useState(null)

  function load() {
    setLoad(true); setError(null)
    api.get('/api/aikikan/dojos')
      .then((r) => setItems(Array.isArray(r) ? r : []))
      .catch((e) => setError(e.message))
      .finally(() => setLoad(false))
  }
  useEffect(load, [])

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim()
    if (!q) return items
    return items.filter((d) =>
      (d.name     ?? '').toLowerCase().includes(q) ||
      (d.city     ?? '').toLowerCase().includes(q) ||
      (d.province ?? '').toLowerCase().includes(q) ||
      (d.sensei   ?? '').toLowerCase().includes(q),
    )
  }, [items, query])

  async function confirmDelete() {
    if (!pendingDelete) return
    try { await api.delete(`/api/aikikan/dojos/${pendingDelete.id}`); toast?.('Dojo eliminado'); load() }
    catch (e) { toast?.(e.message, 'danger') }
  }

  if (loading) return <div className="p-10 text-center text-ink3">Cargando…</div>
  if (error)   return <div className="p-10 text-center text-danger">Error: {error}</div>

  return (
    <div className="p-8 max-w-6xl">
      <div className="flex items-start justify-between gap-6 mb-6">
        <div>
          <div className="text-[12px] uppercase tracking-[0.18em] text-ink3 mb-2">Operaciones</div>
          <h1 className="font-display text-[44px] leading-none tracking-tight">
            <span className="italic font-normal">Dojos</span>
          </h1>
          <p className="text-ink3 mt-3 max-w-2xl text-[14px]">
            Red de dojos del landing. Cualquier cambio aquí se publica en directo
            tanto en la sección "LOS DOJOS" como en el buscador del visitante.
          </p>
        </div>
        <button onClick={() => setOpen(true)} className="px-4 py-2 rounded-md bg-ink text-paper text-[13px] font-medium">
          + Nuevo dojo
        </button>
      </div>

      <div className="mb-5">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por dojo, ciudad, provincia o sensei…"
          className="w-full px-4 py-2.5 border border-line rounded-md bg-white text-[14px]"
        />
        {query && (
          <div className="text-[12px] text-ink3 mt-1.5">
            {filtered.length} resultado{filtered.length !== 1 ? 's' : ''}
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="border border-line bg-paper2 rounded-xl p-10 text-center text-ink3">
          {items.length === 0 ? 'Sin dojos publicados.' : `No se encontraron dojos para "${query}"`}
        </div>
      ) : (
        <div className="bg-white border border-line rounded-xl shadow-card overflow-hidden">
          <table className="w-full text-[13.5px]">
            <thead className="bg-paper2 text-[11px] uppercase tracking-[0.14em] text-ink3">
              <tr>
                <th className="text-left px-4 py-2 font-normal">Dojo</th>
                <th className="text-left px-4 py-2 font-normal">Ubicación</th>
                <th className="text-left px-4 py-2 font-normal">Sensei</th>
                <th className="text-left px-4 py-2 font-normal">Contacto</th>
                <th className="text-right px-4 py-2 font-normal w-24">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((d) => (
                <tr key={d.id} className="border-t border-line hover:bg-paper2">
                  <td className="px-4 py-2.5 font-medium">{d.name}</td>
                  <td className="px-4 py-2.5 text-ink2">{d.city} · {d.province}</td>
                  <td className="px-4 py-2.5 text-ink2">{d.sensei ?? <em className="text-ink3">—</em>}</td>
                  <td className="px-4 py-2.5 text-ink2 text-[12px]">
                    {[d.phone, d.email, d.web].filter(Boolean).join(' · ') || <em className="text-ink3">—</em>}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button onClick={() => setPendingDelete(d)} className="text-[12px] text-danger hover:underline">Eliminar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <NewDojoModal
          onClose={() => setOpen(false)}
          onCreated={() => { setOpen(false); toast?.('Dojo creado'); load() }}
        />
      )}
      {pendingDelete && (
        <ConfirmDialog
          title="Eliminar dojo"
          message={`¿Eliminar el dojo "${pendingDelete.name}"? Esta acción no se puede deshacer.`}
          confirmLabel="Eliminar"
          onConfirm={confirmDelete}
          onClose={() => setPendingDelete(null)}
        />
      )}
    </div>
  )
}

function NewDojoModal({ onClose, onCreated }) {
  const [form, setForm] = useState({
    name: '', city: '', province: '',
    address: '', sensei: '', phone: '', email: '', web: '',
  })
  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState(null)

  function setField(k, v) { setForm((f) => ({ ...f, [k]: v })) }

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      const body = Object.fromEntries(
        Object.entries(form).filter(([, v]) => v && v.trim?.() !== ''),
      )
      await api.post('/api/aikikan/dojos', body)
      onCreated()
    } catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }

  const canSubmit = form.name.trim() && form.city.trim() && form.province.trim()

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30" onClick={onClose}>
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-pop overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="p-6 border-b border-line">
          <div className="font-display text-[22px]">Nuevo dojo</div>
        </div>
        <form className="p-6 space-y-4" onSubmit={submit}>
          <div>
            <div className="label mb-1.5">Nombre *</div>
            <input type="text" required maxLength={128} className="input" value={form.name} onChange={(e) => setField('name', e.target.value)} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="label mb-1.5">Ciudad *</div>
              <input type="text" required maxLength={128} className="input" value={form.city} onChange={(e) => setField('city', e.target.value)} />
            </div>
            <div>
              <div className="label mb-1.5">Provincia *</div>
              <input type="text" required maxLength={128} className="input" value={form.province} onChange={(e) => setField('province', e.target.value)} />
            </div>
          </div>
          <div>
            <div className="label mb-1.5">Dirección</div>
            <input type="text" maxLength={256} className="input" value={form.address} onChange={(e) => setField('address', e.target.value)} />
          </div>
          <div>
            <div className="label mb-1.5">Sensei</div>
            <input type="text" maxLength={256} className="input" value={form.sensei} onChange={(e) => setField('sensei', e.target.value)} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="label mb-1.5">Teléfono</div>
              <input type="tel" maxLength={64} className="input" value={form.phone} onChange={(e) => setField('phone', e.target.value)} />
            </div>
            <div>
              <div className="label mb-1.5">Email</div>
              <input type="email" maxLength={256} className="input" value={form.email} onChange={(e) => setField('email', e.target.value)} />
            </div>
          </div>
          <div>
            <div className="label mb-1.5">Web (sin https://)</div>
            <input type="text" maxLength={256} className="input" value={form.web} onChange={(e) => setField('web', e.target.value)} />
          </div>
          {error && <div className="bg-dangerbg border border-line rounded-lg p-3 text-[12.5px] text-danger">{error}</div>}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn btn-ghost" disabled={busy}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={busy || !canSubmit}>
              {busy ? 'Guardando…' : 'Crear'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
