import { useState } from 'react'
import { useToast } from '../../components/ui/ToastProvider.jsx'
import Button from '../../components/ui/Button.jsx'

const SEGMENTS = [
  { value: 'all', label: 'Todos los alumnos' },
  { value: 'active', label: 'Alumnos con bono activo' },
  { value: 'expiring', label: 'Bonos a punto de caducar' },
]

export default function BroadcastPage() {
  const toast = useToast()
  const [form, setForm] = useState({ segment: 'all', subject: '', message: '' })
  const [sending, setSending] = useState(false)

  const set = (k) => (e) => setForm(p => ({ ...p, [k]: e.target.value }))

  async function submit(e) {
    e.preventDefault()
    if (!confirm(`¿Enviar este mensaje a "${SEGMENTS.find(s => s.value === form.segment)?.label}"?`)) return
    setSending(true)
    try {
      const res = await fetch('/api/notifications/broadcast', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('yoga_token')}`,
        },
        body: JSON.stringify(form),
      })
      if (!res.ok) throw new Error('Error al enviar')
      toast('Notificación enviada correctamente')
      setForm({ segment: 'all', subject: '', message: '' })
    } catch (err) {
      toast(err.message ?? 'Error al enviar', 'error')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-bold text-sage-900">Notificaciones</h1>
        <p className="text-sage-500 text-sm mt-1">Envía comunicaciones masivas a tus alumnos.</p>
      </div>
      <div className="bg-white rounded-2xl shadow-sm p-6">
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-sage-700 mb-1">Destinatarios</label>
            <select value={form.segment} onChange={set('segment')}
              className="w-full border border-sand-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sage-400">
              {SEGMENTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-sage-700 mb-1">Asunto</label>
            <input
              required value={form.subject} onChange={set('subject')}
              className="w-full border border-sand-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sage-400"
              placeholder="ej. Taller especial este sábado"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-sage-700 mb-1">Mensaje</label>
            <textarea
              required rows={5} value={form.message} onChange={set('message')}
              className="w-full border border-sand-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sage-400 resize-none"
              placeholder="Escribe tu mensaje aquí…"
            />
          </div>
          <Button type="submit" className="w-full" disabled={sending}>
            {sending ? 'Enviando…' : 'Enviar notificación'}
          </Button>
        </form>
      </div>
    </div>
  )
}
