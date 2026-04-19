import { useState, useEffect } from 'react'
import { bookings as bookingsApi } from '../../lib/api.js'
import { formatDate, formatTime, STATUS_LABELS, STATUS_COLORS } from '../../lib/utils.js'
import { useToast } from '../../components/ui/ToastProvider.jsx'
import Badge from '../../components/ui/Badge.jsx'
import Button from '../../components/ui/Button.jsx'

export default function BookingsPage() {
  const toast = useToast()
  const [items, setItems] = useState([])
  const [cancelling, setCancelling] = useState(null)

  function load() {
    bookingsApi.list().then(setItems).catch(() => {})
  }

  useEffect(load, [])

  async function cancel(id) {
    setCancelling(id)
    try {
      await bookingsApi.cancel(id)
      toast('Reserva cancelada')
      load()
    } catch (err) {
      toast(err.message ?? 'No se pudo cancelar', 'error')
    } finally {
      setCancelling(null)
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-bold text-sage-900">Mis reservas</h1>
        <p className="text-sage-500 text-sm mt-1">Historial y reservas activas.</p>
      </div>
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        {items.length === 0 ? (
          <p className="text-center text-sage-400 py-12">No tienes reservas todavía.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-sand-50 border-b border-sand-200 text-left">
                <th className="px-4 py-3 font-medium text-sage-700">Clase</th>
                <th className="px-4 py-3 font-medium text-sage-700">Fecha</th>
                <th className="px-4 py-3 font-medium text-sage-700">Estado</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {items.map(b => (
                <tr key={b.id} className="trow border-b border-sand-100 last:border-0">
                  <td className="px-4 py-3 font-medium text-sage-900">{b.class_name ?? 'Clase'}</td>
                  <td className="px-4 py-3 text-sage-600">{formatDate(b.session_date)} {formatTime(b.start_time)}</td>
                  <td className="px-4 py-3"><Badge className={STATUS_COLORS[b.status]}>{STATUS_LABELS[b.status]}</Badge></td>
                  <td className="px-4 py-3">
                    {b.status === 'confirmed' && (
                      <Button variant="ghost" size="sm" disabled={cancelling === b.id} onClick={() => cancel(b.id)}>
                        Cancelar
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
