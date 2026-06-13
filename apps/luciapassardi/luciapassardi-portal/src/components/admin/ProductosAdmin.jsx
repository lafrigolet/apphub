import { useEffect, useState } from 'react'
import AdminBar from './AdminBar.jsx'
import { listProductos, crearProducto, editarProducto, borrarProducto } from '../../lib/studio.js'

const CATS = ['Esterillas', 'Props', 'Ropa', 'Bienestar', 'Bonos']
const TIPOS = [['physical', 'Físico'], ['service', 'Servicio/Bono'], ['digital', 'Digital'], ['bundle', 'Pack'], ['subscription', 'Suscripción']]
const eur = (c) => `${((c ?? 0) / 100).toFixed(2)} €`
const price = (it) => it.price_cents ?? it.priceCents ?? 0

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

export default function ProductosAdmin() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)

  const [editId, setEditId] = useState(null)
  const [nombre, setNombre] = useState('')
  const [categoria, setCategoria] = useState('')
  const [precio, setPrecio] = useState('')      // en euros
  const [tipo, setTipo] = useState('physical')
  const [descripcion, setDescripcion] = useState('')
  const [activo, setActivo] = useState(true)

  function reload() {
    setLoading(true)
    listProductos().then(setItems).catch((e) => setErr(e.message)).finally(() => setLoading(false))
  }
  useEffect(reload, [])

  function resetForm() {
    setEditId(null); setNombre(''); setCategoria(''); setPrecio(''); setTipo('physical'); setDescripcion(''); setActivo(true); setErr('')
  }

  function startEdit(it) {
    setEditId(it.id)
    setNombre(it.name ?? '')
    setCategoria(it.category ?? '')
    setPrecio((price(it) / 100).toString())
    setTipo(it.item_type ?? it.itemType ?? 'physical')
    setDescripcion(it.description ?? '')
    setActivo(it.active !== false)
    setErr('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function onSubmit(e) {
    e.preventDefault()
    setErr('')
    if (!nombre || precio === '') { setErr('Nombre y precio son obligatorios'); return }
    const priceCents = Math.round(Number(precio) * 100)
    if (!(priceCents >= 0)) { setErr('Precio inválido'); return }
    setSaving(true)
    try {
      if (editId) {
        await editarProducto(editId, { name: nombre, priceCents, category: categoria || undefined, description: descripcion || undefined, active: activo })
      } else {
        await crearProducto({ name: nombre, priceCents, category: categoria, itemType: tipo, description: descripcion })
      }
      resetForm()
      reload()
    } catch (e2) {
      setErr(e2.message ?? 'No se pudo guardar el producto')
    } finally {
      setSaving(false)
    }
  }

  async function onBorrar(id) {
    if (!window.confirm('¿Eliminar este producto?')) return
    try { await borrarProducto(id); if (editId === id) resetForm(); reload() } catch (e) { setErr(e.message) }
  }

  const cats = [...new Set(items.map((i) => i.category || 'Sin categoría'))].sort()

  return (
    <div className="min-h-screen bg-piedra text-tinta">
      <AdminBar active="productos" />
      <div className="max-w-5xl mx-auto px-5 py-10">
        <p className="eyebrow">Backoffice · Tienda</p>
        <h1 className="display text-4xl sm:text-5xl mt-2 mb-2">Productos</h1>
        <p className="text-tinta/60 mb-8">Catálogo del marketplace. Pulsa el lápiz para editar o la × para eliminar.</p>

        {/* Crear / editar */}
        <form onSubmit={onSubmit} className={`card-zen p-6 mb-10 grid sm:grid-cols-4 gap-4 ${editId ? 'ring-1 ring-teal-500/40' : ''}`}>
          <div className="sm:col-span-4 flex items-center justify-between">
            <span className="eyebrow">{editId ? 'Editar producto' : 'Nuevo producto'}</span>
            {editId && <button type="button" onClick={resetForm} className="text-sm text-tinta/55 hover:text-teal-600">Cancelar edición</button>}
          </div>
          <div className="sm:col-span-2">
            <label className="block text-[12px] uppercase tracking-widest text-tinta/45 font-semibold mb-1">Nombre</label>
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Esterilla Sattva"
              className="w-full rounded-xl border border-tinta/15 bg-crema px-4 py-2.5 focus:outline-none focus:border-teal-500" />
          </div>
          <div>
            <label className="block text-[12px] uppercase tracking-widest text-tinta/45 font-semibold mb-1">Precio (€)</label>
            <input type="number" min="0" step="0.01" value={precio} onChange={(e) => setPrecio(e.target.value)} placeholder="69.00"
              className="w-full rounded-xl border border-tinta/15 bg-crema px-4 py-2.5 focus:outline-none focus:border-teal-500" />
          </div>
          <div>
            <label className="block text-[12px] uppercase tracking-widest text-tinta/45 font-semibold mb-1">Categoría</label>
            <input list="cats" value={categoria} onChange={(e) => setCategoria(e.target.value)} placeholder="Esterillas"
              className="w-full rounded-xl border border-tinta/15 bg-crema px-4 py-2.5 focus:outline-none focus:border-teal-500" />
            <datalist id="cats">{CATS.map((c) => <option key={c} value={c} />)}</datalist>
          </div>
          <div className="sm:col-span-2">
            <label className="block text-[12px] uppercase tracking-widest text-tinta/45 font-semibold mb-1">Tipo</label>
            <select value={tipo} onChange={(e) => setTipo(e.target.value)} disabled={!!editId}
              className="w-full rounded-xl border border-tinta/15 bg-crema px-4 py-2.5 focus:outline-none focus:border-teal-500 disabled:opacity-60">
              {TIPOS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm self-end pb-2">
            <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} /> Activo (visible)
          </label>
          <div className="sm:col-span-4">
            <label className="block text-[12px] uppercase tracking-widest text-tinta/45 font-semibold mb-1">Descripción</label>
            <textarea value={descripcion} onChange={(e) => setDescripcion(e.target.value)} rows={2}
              className="w-full rounded-xl border border-tinta/15 bg-crema px-4 py-2.5 focus:outline-none focus:border-teal-500" />
          </div>
          {err && <p className="sm:col-span-4 text-sm text-red-700 bg-red-500/10 rounded-lg px-3 py-2">{err}</p>}
          <div className="sm:col-span-4 flex justify-end">
            <button type="submit" disabled={saving} className="btn-zen btn-fill">
              {saving ? 'Guardando…' : editId ? 'Guardar cambios' : 'Añadir producto'}
            </button>
          </div>
        </form>

        {/* Listado por categoría */}
        {loading ? (
          <p className="text-tinta/50">Cargando…</p>
        ) : items.length === 0 ? (
          <p className="text-tinta/50 italic">Aún no hay productos. Añade el primero arriba.</p>
        ) : (
          <div className="space-y-8">
            {cats.map((cat) => (
              <div key={cat}>
                <h2 className="display text-2xl mb-3">{cat}</h2>
                <ul className="space-y-2.5">
                  {items.filter((i) => (i.category || 'Sin categoría') === cat).map((it) => (
                    <li key={it.id} className={`card-zen p-4 flex items-center justify-between gap-4 ${editId === it.id ? 'ring-1 ring-teal-500/50' : ''} ${it.active === false ? 'opacity-60' : ''}`}>
                      <div className="min-w-0">
                        <p className="font-semibold text-tinta">{it.name}{it.active === false ? ' · (oculto)' : ''}</p>
                        {it.description ? <p className="text-sm text-tinta/55 truncate">{it.description}</p> : null}
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="display text-xl text-teal-700">{eur(price(it))}</span>
                        <button onClick={() => startEdit(it)} title="Editar" className="p-1.5 rounded text-tinta/40 hover:text-teal-600 hover:bg-teal-500/10"><Pencil /></button>
                        <button onClick={() => onBorrar(it.id)} title="Eliminar" className="p-1.5 rounded text-tinta/40 hover:text-red-700 hover:bg-red-500/10"><X /></button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
