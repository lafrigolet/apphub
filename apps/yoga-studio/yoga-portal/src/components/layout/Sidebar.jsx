import { NavLink } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext.jsx'
import { cn, getInitials } from '../../lib/utils.js'

const alumnoLinks = [
  { to: '/app/dashboard', label: 'Inicio', icon: '🏠' },
  { to: '/app/calendar', label: 'Clases', icon: '📅' },
  { to: '/app/bookings', label: 'Mis reservas', icon: '🎫' },
  { to: '/app/bonuses', label: 'Mi bono', icon: '💳' },
  { to: '/app/profile', label: 'Perfil', icon: '👤' },
]

const instructorLinks = [
  { to: '/app/dashboard', label: 'Inicio', icon: '🏠' },
  { to: '/app/my-classes', label: 'Mis clases', icon: '📋' },
  { to: '/app/attendance', label: 'Asistencia', icon: '✅' },
  { to: '/app/profile', label: 'Perfil', icon: '👤' },
]

const adminLinks = [
  { to: '/app/dashboard', label: 'Dashboard', icon: '📊' },
  { to: '/app/classes', label: 'Clases', icon: '🧘' },
  { to: '/app/students', label: 'Alumnos', icon: '👥' },
  { to: '/app/admin-bonuses', label: 'Bonos', icon: '💳' },
  { to: '/app/reports', label: 'Reportes', icon: '📈' },
  { to: '/app/broadcast', label: 'Notificaciones', icon: '📢' },
  { to: '/app/profile', label: 'Perfil', icon: '👤' },
]

const roleLinks = { alumno: alumnoLinks, instructor: instructorLinks, admin: adminLinks }

export default function Sidebar({ collapsed }) {
  const { user, logout } = useAuth()
  const links = roleLinks[user?.role] ?? alumnoLinks

  return (
    <aside className={cn(
      'flex flex-col bg-sage-900 text-sage-100 transition-all duration-300 h-full',
      collapsed ? 'w-16' : 'w-56'
    )}>
      <div className={cn('flex items-center gap-3 px-4 py-5 border-b border-sage-700', collapsed && 'justify-center px-2')}>
        {!collapsed && (
          <span className="font-serif font-bold text-white text-lg">
            Serenity<span className="text-warm-400">Yoga</span>
          </span>
        )}
        {collapsed && <span className="font-serif font-bold text-white text-lg">SY</span>}
      </div>
      <nav className="flex-1 py-4 space-y-1 px-2 overflow-y-auto">
        {links.map(l => (
          <NavLink
            key={l.to}
            to={l.to}
            end={l.to.endsWith('dashboard')}
            className={({ isActive }) => cn(
              'sidebar-item',
              isActive && 'bg-sage-700 text-white'
            )}
            title={collapsed ? l.label : undefined}
          >
            <span className="text-base flex-shrink-0">{l.icon}</span>
            {!collapsed && <span className="text-sm">{l.label}</span>}
          </NavLink>
        ))}
      </nav>
      <div className={cn('p-3 border-t border-sage-700 flex items-center gap-3', collapsed && 'justify-center')}>
        <div className="w-8 h-8 rounded-full bg-sage-600 flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
          {getInitials(user?.email ?? '')}
        </div>
        {!collapsed && (
          <div className="flex-1 min-w-0">
            <p className="text-xs text-white truncate">{user?.email}</p>
            <button onClick={logout} className="text-xs text-sage-400 hover:text-white transition-colors">
              Cerrar sesión
            </button>
          </div>
        )}
      </div>
    </aside>
  )
}
