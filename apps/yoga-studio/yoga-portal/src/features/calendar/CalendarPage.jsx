import { useState, useEffect } from 'react'
import { classes as classesApi, bookings as bookingsApi } from '../../lib/api.js'
import { formatDate, formatTime, TYPE_LABELS, LEVEL_LABELS, LEVEL_COLORS, cn } from '../../lib/utils.js'
import { useToast } from '../../components/ui/ToastProvider.jsx'
import Badge from '../../components/ui/Badge.jsx'
import Button from '../../components/ui/Button.jsx'

const LEVELS = ['todos', 'principiante', 'intermedio', 'avanzado']

export default function CalendarPage() {
  const toast = useToast()
  const [items, setItems] = useState([])
  const [level, setLevel] = useState('todos')
  const [booking, setBooking] = useState(null)

  useEffect(() => {
    classesApi.list().then(setItems).catch(() => {})
  }, [])

  async function book(classItem) {
    setBooking(classItem.id)
    try {
      await bookingsApi.create({ classId: classItem.id })
      toast('¡Clase reservada!')
    } catch (err) {
      toast(err.message ?? 'No se pudo reservar', 'error')
    } finally {
      setBooking(null)
    }
  }

  const filtered = level === 'todos' ? items : items.filter(c => c.level === level)

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-bold text-sage-900">Clases disponibles</h1>
        <p className="text-sage-500 text-sm mt-1">Reserva tu próxima sesión.</p>
      </div>
      <div className="flex gap-2 flex-wrap">
        {LEVELS.map(l => (
          <button
            key={l}
            onClick={() => setLevel(l)}
            className={cn(
              'px-3 py-1 rounded-full text-xs font-medium transition-colors',
              level === l ? 'bg-sage-600 text-white' : 'bg-white text-sage-700 border border-sage-200 hover:border-sage-400'
            )}
          >
            {LEVEL_LABELS[l]}
          </button>
        ))}
      </div>
      <div className="space-y-3">
        {filtered.map(c => (
          <div key={c.id} className="bg-white rounded-2xl p-5 shadow-sm flex items-center justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="font-semibold text-sage-900">{c.name}</h3>
                <Badge className={LEVEL_COLORS[c.level]}>{LEVEL_LABELS[c.level]}</Badge>
              </div>
              <p className="text-xs text-sage-500">{TYPE_LABELS[c.type] ?? c.type} · {formatTime(c.start_time)} · {c.duration_min} min</p>
            </div>
            <Button
              size="sm"
              disabled={booking === c.id}
              onClick={() => book(c)}
            >
              {booking === c.id ? '…' : 'Reservar'}
            </Button>
          </div>
        ))}
        {filtered.length === 0 && (
          <p className="text-center text-sage-400 py-12">No hay clases disponibles con este filtro.</p>
        )}
      </div>
    </div>
  )
}
