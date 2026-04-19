import { todayLabel } from '../../lib/utils.js'
import { useAuth } from '../../context/AuthContext.jsx'

export default function TopBar({ onToggleSidebar }) {
  const { user } = useAuth()
  return (
    <header className="h-14 bg-white border-b border-sand-200 flex items-center justify-between px-4 flex-shrink-0">
      <button
        onClick={onToggleSidebar}
        className="w-8 h-8 rounded-lg flex items-center justify-center text-sage-600 hover:bg-sand-100 transition-colors"
        aria-label="Toggle sidebar"
      >
        ☰
      </button>
      <span className="text-sm text-sage-500 capitalize">{todayLabel()}</span>
      <div className="text-sm font-medium text-sage-700 capitalize">
        {user?.role === 'alumno' ? 'Alumno' : user?.role === 'instructor' ? 'Instructor' : 'Administrador'}
      </div>
    </header>
  )
}
