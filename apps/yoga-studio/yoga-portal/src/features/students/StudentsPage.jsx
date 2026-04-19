import { useState, useEffect } from 'react'
import { users as usersApi } from '../../lib/api.js'
import { formatDate, getInitials } from '../../lib/utils.js'

export default function StudentsPage() {
  const [students, setStudents] = useState([])
  const [search, setSearch] = useState('')

  useEffect(() => {
    usersApi.list({ role: 'alumno' }).then(setStudents).catch(() => {})
  }, [])

  const filtered = students.filter(s =>
    s.name?.toLowerCase().includes(search.toLowerCase()) ||
    s.email?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-bold text-sage-900">Alumnos</h1>
        <p className="text-sage-500 text-sm mt-1">Gestión de alumnos registrados.</p>
      </div>
      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Buscar por nombre o email…"
        className="w-full border border-sand-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sage-400 bg-white"
      />
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        {filtered.length === 0 ? (
          <p className="text-center text-sage-400 py-12">No se encontraron alumnos.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-sand-50 border-b border-sand-200 text-left">
                <th className="px-4 py-3 font-medium text-sage-700">Alumno</th>
                <th className="px-4 py-3 font-medium text-sage-700">Email</th>
                <th className="px-4 py-3 font-medium text-sage-700">Registrado</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(s => (
                <tr key={s.id} className="trow border-b border-sand-100 last:border-0">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-sage-100 flex items-center justify-center text-xs font-bold text-sage-700 flex-shrink-0">
                        {getInitials(s.name ?? s.email ?? '')}
                      </div>
                      <span className="font-medium text-sage-900">{s.name ?? '—'}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sage-600">{s.email}</td>
                  <td className="px-4 py-3 text-sage-500">{formatDate(s.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
