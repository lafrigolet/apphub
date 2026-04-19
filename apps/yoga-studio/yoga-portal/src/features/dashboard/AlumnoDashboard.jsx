import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { bookings as bookingsApi, bonuses as bonusesApi } from '../../lib/api.js'
import { formatDate, formatTime, STATUS_LABELS, STATUS_COLORS } from '../../lib/utils.js'
import Badge from '../../components/ui/Badge.jsx'

export default function AlumnoDashboard() {
  const [bookings, setBookings] = useState([])
  const [bonus, setBonus] = useState(null)

  useEffect(() => {
    bookingsApi.list().then(setBookings).catch(() => {})
    bonusesApi.me().then(d => setBonus(d?.[0] ?? null)).catch(() => {})
  }, [])

  const upcoming = bookings.filter(b => b.status === 'confirmed').slice(0, 3)
  const sessionsLeft = bonus ? bonus.sessions_total - bonus.sessions_used : null

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-bold text-sage-900">Mi espacio</h1>
        <p className="text-sage-500 text-sm mt-1">Aquí tienes tu resumen de hoy.</p>
      </div>

      {bonus && (
        <div className="bg-sage-700 text-white rounded-2xl p-5">
          <p className="text-sage-200 text-sm mb-1">Tu bono activo</p>
          <p className="text-2xl font-bold">{sessionsLeft} clases restantes</p>
          <div className="mt-3 bg-sage-600 rounded-full h-2">
            <div
              className="bg-warm-400 h-2 rounded-full transition-all"
              style={{ width: `${100 - (bonus.sessions_used / bonus.sessions_total) * 100}%` }}
            />
          </div>
          <p className="text-xs text-sage-300 mt-2">Caduca el {formatDate(bonus.expires_at)}</p>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-sage-900">Próximas reservas</h2>
          <Link to="/app/bookings" className="text-sm text-sage-600 hover:underline">Ver todas</Link>
        </div>
        {upcoming.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-sage-400 text-sm mb-3">No tienes clases reservadas</p>
            <Link to="/app/calendar" className="text-sm text-sage-600 font-medium hover:underline">Explorar clases →</Link>
          </div>
        ) : (
          <div className="space-y-3">
            {upcoming.map(b => (
              <div key={b.id} className="flex items-center justify-between trow px-3 py-2 rounded-lg">
                <div>
                  <p className="text-sm font-medium text-sage-900">{b.class_name ?? 'Clase'}</p>
                  <p className="text-xs text-sage-500">{formatDate(b.session_date)} · {formatTime(b.start_time)}</p>
                </div>
                <Badge className={STATUS_COLORS[b.status]}>{STATUS_LABELS[b.status]}</Badge>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Link to="/app/calendar" className="bg-white rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow text-center">
          <div className="text-3xl mb-2">📅</div>
          <p className="font-medium text-sage-900 text-sm">Reservar clase</p>
        </Link>
        <Link to="/app/bonuses" className="bg-white rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow text-center">
          <div className="text-3xl mb-2">💳</div>
          <p className="font-medium text-sage-900 text-sm">Mis bonos</p>
        </Link>
      </div>
    </div>
  )
}
