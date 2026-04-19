import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { classes as classesApi } from '../../lib/api.js'
import { formatDate, formatTime } from '../../lib/utils.js'

export default function InstructorDashboard() {
  const [agenda, setAgenda] = useState([])

  useEffect(() => {
    classesApi.instructorAgenda().then(setAgenda).catch(() => {})
  }, [])

  const today = agenda.filter(s => {
    const d = new Date(s.session_date)
    const now = new Date()
    return d.toDateString() === now.toDateString()
  })

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-bold text-sage-900">Panel del instructor</h1>
        <p className="text-sage-500 text-sm mt-1">Tus clases de hoy y próximas sesiones.</p>
      </div>

      <div className="bg-white rounded-2xl shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-sage-900">Clases de hoy</h2>
          <Link to="/app/attendance" className="text-sm text-sage-600 hover:underline">Marcar asistencia</Link>
        </div>
        {today.length === 0 ? (
          <p className="text-sage-400 text-sm py-6 text-center">No tienes clases programadas para hoy.</p>
        ) : (
          <div className="space-y-3">
            {today.map(s => (
              <div key={s.session_id} className="trow flex items-center justify-between px-3 py-2 rounded-lg">
                <div>
                  <p className="text-sm font-medium text-sage-900">{s.class_name}</p>
                  <p className="text-xs text-sage-500">{formatTime(s.start_time)} · {s.duration_min} min</p>
                </div>
                <span className="text-xs text-sage-600 bg-sand-100 px-2 py-1 rounded-full">
                  {s.spots_taken ?? 0} / {s.max_capacity}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-sage-900">Próximas sesiones</h2>
          <Link to="/app/my-classes" className="text-sm text-sage-600 hover:underline">Ver agenda</Link>
        </div>
        {agenda.slice(0, 5).map(s => (
          <div key={s.session_id} className="trow flex items-center justify-between px-3 py-2 rounded-lg">
            <div>
              <p className="text-sm font-medium text-sage-900">{s.class_name}</p>
              <p className="text-xs text-sage-500">{formatDate(s.session_date)} · {formatTime(s.start_time)}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
