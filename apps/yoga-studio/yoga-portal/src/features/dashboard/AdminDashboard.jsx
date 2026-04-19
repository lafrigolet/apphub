import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { reports as reportsApi } from '../../lib/api.js'

export default function AdminDashboard() {
  const [metrics, setMetrics] = useState(null)

  useEffect(() => {
    reportsApi.dashboard().then(setMetrics).catch(() => {})
  }, [])

  const stats = [
    { label: 'Clases hoy', value: metrics?.classes_today ?? '—', icon: '🧘', link: '/app/classes' },
    { label: 'Reservas hoy', value: metrics?.bookings_today ?? '—', icon: '🎫', link: '/app/reports' },
    { label: 'Alumnos activos', value: metrics?.active_students ?? '—', icon: '👥', link: '/app/students' },
    { label: 'Ingresos mes', value: metrics?.revenue_month ? `${metrics.revenue_month}€` : '—', icon: '💰', link: '/app/reports' },
  ]

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-bold text-sage-900">Panel de administración</h1>
        <p className="text-sage-500 text-sm mt-1">Resumen general del estudio.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {stats.map(s => (
          <Link key={s.label} to={s.link} className="bg-white rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow">
            <div className="text-2xl mb-2">{s.icon}</div>
            <div className="text-2xl font-bold text-sage-900">{s.value}</div>
            <div className="text-xs text-sage-500 mt-1">{s.label}</div>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl shadow-sm p-5">
          <h2 className="font-semibold text-sage-900 mb-3">Acciones rápidas</h2>
          <div className="space-y-2">
            {[
              { to: '/app/classes', label: 'Gestionar clases', icon: '🧘' },
              { to: '/app/students', label: 'Ver alumnos', icon: '👥' },
              { to: '/app/admin-bonuses', label: 'Asignar bonos', icon: '💳' },
              { to: '/app/broadcast', label: 'Enviar notificación', icon: '📢' },
            ].map(a => (
              <Link key={a.to} to={a.to} className="flex items-center gap-3 px-3 py-2 rounded-lg trow text-sm">
                <span>{a.icon}</span>
                <span className="text-sage-800">{a.label}</span>
              </Link>
            ))}
          </div>
        </div>
        <div className="bg-white rounded-2xl shadow-sm p-5">
          <h2 className="font-semibold text-sage-900 mb-3">Estadísticas del mes</h2>
          {metrics ? (
            <div className="space-y-3 text-sm">
              <div className="flex justify-between text-sage-700">
                <span>Total clases</span><span className="font-semibold">{metrics.classes_month ?? '—'}</span>
              </div>
              <div className="flex justify-between text-sage-700">
                <span>Asistencia media</span><span className="font-semibold">{metrics.avg_attendance ?? '—'}%</span>
              </div>
              <div className="flex justify-between text-sage-700">
                <span>No presentados</span><span className="font-semibold">{metrics.no_shows_month ?? '—'}</span>
              </div>
              <div className="flex justify-between text-sage-700">
                <span>Cancelaciones</span><span className="font-semibold">{metrics.cancellations_month ?? '—'}</span>
              </div>
            </div>
          ) : (
            <p className="text-sage-400 text-sm">Cargando métricas…</p>
          )}
        </div>
      </div>
    </div>
  )
}
