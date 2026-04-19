import { useState, useEffect } from 'react'
import { classes as classesApi } from '../../lib/api.js'
import { formatTime, TYPE_LABELS, LEVEL_LABELS, LEVEL_COLORS } from '../../lib/utils.js'
import { useToast } from '../../components/ui/ToastProvider.jsx'
import Badge from '../../components/ui/Badge.jsx'
import Button from '../../components/ui/Button.jsx'
import Modal from '../../components/ui/Modal.jsx'

const EMPTY = { name: '', type: 'hatha', level: 'todos', start_time: '09:00', duration_min: 60, max_capacity: 15 }

export default function ClassesPage() {
  const toast = useToast()
  const [items, setItems] = useState([])
  const [modal, setModal] = useState(null) // null | 'create' | classObj
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)

  function load() { classesApi.list().then(setItems).catch(() => {}) }
  useEffect(load, [])

  const set = (k) => (e) => setForm(p => ({ ...p, [k]: e.target.value }))

  function openCreate() { setForm(EMPTY); setModal('create') }
  function openEdit(c) { setForm({ ...c }); setModal(c) }

  async function submit(e) {
    e.preventDefault()
    setSaving(true)
    try {
      if (modal === 'create') {
        await classesApi.create(form)
        toast('Clase creada')
      } else {
        await classesApi.update(modal.id, form)
        toast('Clase actualizada')
      }
      load()
      setModal(null)
    } catch (err) {
      toast(err.message ?? 'Error', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function remove(id) {
    if (!confirm('¿Eliminar esta clase?')) return
    try {
      await classesApi.remove(id)
      toast('Clase eliminada')
      load()
    } catch (err) {
      toast(err.message ?? 'Error', 'error')
    }
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-serif text-2xl font-bold text-sage-900">Clases</h1>
          <p className="text-sage-500 text-sm mt-1">Gestiona el catálogo de clases.</p>
        </div>
        <Button onClick={openCreate}>+ Nueva clase</Button>
      </div>

      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-sand-50 border-b border-sand-200 text-left">
              <th className="px-4 py-3 font-medium text-sage-700">Nombre</th>
              <th className="px-4 py-3 font-medium text-sage-700">Tipo</th>
              <th className="px-4 py-3 font-medium text-sage-700">Nivel</th>
              <th className="px-4 py-3 font-medium text-sage-700">Hora</th>
              <th className="px-4 py-3 font-medium text-sage-700">Cap.</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {items.map(c => (
              <tr key={c.id} className="trow border-b border-sand-100 last:border-0">
                <td className="px-4 py-3 font-medium text-sage-900">{c.name}</td>
                <td className="px-4 py-3 text-sage-600">{TYPE_LABELS[c.type] ?? c.type}</td>
                <td className="px-4 py-3"><Badge className={LEVEL_COLORS[c.level]}>{LEVEL_LABELS[c.level]}</Badge></td>
                <td className="px-4 py-3 text-sage-600">{formatTime(c.start_time)}</td>
                <td className="px-4 py-3 text-sage-600">{c.max_capacity}</td>
                <td className="px-4 py-3 flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => openEdit(c)}>Editar</Button>
                  <Button variant="danger" size="sm" onClick={() => remove(c.id)}>Eliminar</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={!!modal} onClose={() => setModal(null)} title={modal === 'create' ? 'Nueva clase' : 'Editar clase'}>
        <form onSubmit={submit} className="space-y-3">
          {[['name', 'Nombre'], ['start_time', 'Hora inicio']].map(([k, l]) => (
            <div key={k}>
              <label className="block text-sm font-medium text-sage-700 mb-1">{l}</label>
              <input value={form[k]} onChange={set(k)} required
                className="w-full border border-sand-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sage-400"
              />
            </div>
          ))}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-sage-700 mb-1">Tipo</label>
              <select value={form.type} onChange={set('type')} className="w-full border border-sand-300 rounded-lg px-3 py-2 text-sm">
                {Object.entries(TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-sage-700 mb-1">Nivel</label>
              <select value={form.level} onChange={set('level')} className="w-full border border-sand-300 rounded-lg px-3 py-2 text-sm">
                {Object.entries(LEVEL_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-sage-700 mb-1">Duración (min)</label>
              <input type="number" value={form.duration_min} onChange={set('duration_min')}
                className="w-full border border-sand-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-sage-700 mb-1">Capacidad máx.</label>
              <input type="number" value={form.max_capacity} onChange={set('max_capacity')}
                className="w-full border border-sand-300 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <Button type="submit" className="w-full mt-2" disabled={saving}>
            {saving ? 'Guardando…' : modal === 'create' ? 'Crear clase' : 'Guardar cambios'}
          </Button>
        </form>
      </Modal>
    </div>
  )
}
