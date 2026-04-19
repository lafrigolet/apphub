import { useState, useEffect } from 'react'
import { classes as classesApi, bookings as bookingsApi } from '../../lib/api.js'
import { formatDate, formatTime } from '../../lib/utils.js'
import { useToast } from '../../components/ui/ToastProvider.jsx'
import Button from '../../components/ui/Button.jsx'

export default function AttendancePage() {
  const toast = useToast()
  const [agenda, setAgenda] = useState([])
  const [selected, setSelected] = useState(null)
  const [sessionBookings, setSessionBookings] = useState([])
  const [marking, setMarking] = useState(null)

  useEffect(() => {
    classesApi.instructorAgenda().then(data => {
      setAgenda(data)
      if (data.length > 0) setSelected(data[0])
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (!selected) return
    bookingsApi.list().then(all => {
      setSessionBookings(all.filter(b => b.session_id === selected.session_id && b.status === 'confirmed'))
    }).catch(() => {})
  }, [selected])

  async function markAttended(bookingId) {
    setMarking(bookingId)
    try {
      await bookingsApi.attend(bookingId)
      toast('Asistencia marcada')
      setSessionBookings(prev => prev.map(b => b.id === bookingId ? { ...b, status: 'attended' } : b))
    } catch (err) {
      toast(err.message ?? 'Error', 'error')
    } finally {
      setMarking(null)
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-bold text-sage-900">Control de asistencia</h1>
        <p className="text-sage-500 text-sm mt-1">Marca la asistencia de tus alumnos.</p>
      </div>

      <div className="flex gap-2 flex-wrap">
        {agenda.map(s => (
          <button
            key={s.session_id}
            onClick={() => setSelected(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${selected?.session_id === s.session_id ? 'bg-sage-600 text-white' : 'bg-white text-sage-700 border border-sage-200 hover:border-sage-400'}`}
          >
            {s.class_name} · {formatDate(s.session_date)}
          </button>
        ))}
      </div>

      {selected && (
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <div className="bg-sand-50 px-4 py-3 border-b border-sand-200">
            <p className="font-semibold text-sage-900">{selected.class_name}</p>
            <p className="text-xs text-sage-500">{formatDate(selected.session_date)} · {formatTime(selected.start_time)}</p>
          </div>
          {sessionBookings.length === 0 ? (
            <p className="text-center text-sage-400 py-8">No hay reservas para esta sesión.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-sand-100 text-left">
                  <th className="px-4 py-3 font-medium text-sage-700">Alumno</th>
                  <th className="px-4 py-3 font-medium text-sage-700">Estado</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {sessionBookings.map(b => (
                  <tr key={b.id} className="trow border-b border-sand-100 last:border-0">
                    <td className="px-4 py-3 text-sage-900">{b.user_email ?? b.user_id}</td>
                    <td className="px-4 py-3 text-sage-600 capitalize">{b.status}</td>
                    <td className="px-4 py-3">
                      {b.status === 'confirmed' && (
                        <Button size="sm" disabled={marking === b.id} onClick={() => markAttended(b.id)}>
                          {marking === b.id ? '…' : 'Asistió'}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
