import { useState, useEffect } from 'react'
import { reports as reportsApi } from '../../lib/api.js'
import { formatDate } from '../../lib/utils.js'
import { useToast } from '../../components/ui/ToastProvider.jsx'
import Button from '../../components/ui/Button.jsx'

export default function ReportsPage() {
  const toast = useToast()
  const [attendance, setAttendance] = useState([])
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [exporting, setExporting] = useState(false)

  function load() {
    const params = {}
    if (from) params.from = from
    if (to) params.to = to
    reportsApi.attendance(params).then(setAttendance).catch(() => {})
  }

  useEffect(load, [])

  async function exportCSV() {
    setExporting(true)
    try {
      await reportsApi.exportAttendance()
      toast('Exportación iniciada. Recibirás el archivo por email.')
    } catch (err) {
      toast(err.message ?? 'Error al exportar', 'error')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-serif text-2xl font-bold text-sage-900">Reportes</h1>
          <p className="text-sage-500 text-sm mt-1">Asistencia y métricas del estudio.</p>
        </div>
        <Button variant="secondary" disabled={exporting} onClick={exportCSV}>
          {exporting ? 'Exportando…' : 'Exportar CSV'}
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <input type="date" value={from} onChange={e => setFrom(e.target.value)}
          className="border border-sand-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sage-400" />
        <span className="text-sage-500 text-sm">hasta</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)}
          className="border border-sand-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sage-400" />
        <Button size="sm" onClick={load}>Filtrar</Button>
      </div>

      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        {attendance.length === 0 ? (
          <p className="text-center text-sage-400 py-12">No hay datos para el período seleccionado.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-sand-50 border-b border-sand-200 text-left">
                <th className="px-4 py-3 font-medium text-sage-700">Fecha</th>
                <th className="px-4 py-3 font-medium text-sage-700">Clase</th>
                <th className="px-4 py-3 font-medium text-sage-700">Reservas</th>
                <th className="px-4 py-3 font-medium text-sage-700">Asistidos</th>
                <th className="px-4 py-3 font-medium text-sage-700">No shows</th>
              </tr>
            </thead>
            <tbody>
              {attendance.map((r, i) => (
                <tr key={i} className="trow border-b border-sand-100 last:border-0">
                  <td className="px-4 py-3 text-sage-600">{formatDate(r.date)}</td>
                  <td className="px-4 py-3 font-medium text-sage-900">{r.class_name}</td>
                  <td className="px-4 py-3 text-sage-600">{r.total_bookings}</td>
                  <td className="px-4 py-3 text-sage-600">{r.attended}</td>
                  <td className="px-4 py-3 text-sage-600">{r.no_shows}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
