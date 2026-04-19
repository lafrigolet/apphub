import { useState, useEffect } from 'react'
import { classes as classesApi } from '../../lib/api.js'
import { formatDate, formatTime, LEVEL_LABELS, LEVEL_COLORS } from '../../lib/utils.js'
import Badge from '../../components/ui/Badge.jsx'

export default function InstructorClassesPage() {
  const [agenda, setAgenda] = useState([])

  useEffect(() => {
    classesApi.instructorAgenda().then(setAgenda).catch(() => {})
  }, [])

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-bold text-sage-900">Mis clases</h1>
        <p className="text-sage-500 text-sm mt-1">Tu agenda de sesiones próximas.</p>
      </div>
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        {agenda.length === 0 ? (
          <p className="text-center text-sage-400 py-12">No tienes sesiones programadas.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-sand-50 border-b border-sand-200 text-left">
                <th className="px-4 py-3 font-medium text-sage-700">Clase</th>
                <th className="px-4 py-3 font-medium text-sage-700">Fecha</th>
                <th className="px-4 py-3 font-medium text-sage-700">Nivel</th>
                <th className="px-4 py-3 font-medium text-sage-700">Alumnos</th>
              </tr>
            </thead>
            <tbody>
              {agenda.map(s => (
                <tr key={s.session_id} className="trow border-b border-sand-100 last:border-0">
                  <td className="px-4 py-3 font-medium text-sage-900">{s.class_name}</td>
                  <td className="px-4 py-3 text-sage-600">{formatDate(s.session_date)} {formatTime(s.start_time)}</td>
                  <td className="px-4 py-3"><Badge className={LEVEL_COLORS[s.level]}>{LEVEL_LABELS[s.level]}</Badge></td>
                  <td className="px-4 py-3 text-sage-700">{s.spots_taken ?? 0} / {s.max_capacity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
