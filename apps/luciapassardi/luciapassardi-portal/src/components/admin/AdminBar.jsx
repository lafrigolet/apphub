import { Link, useNavigate } from 'react-router-dom'
import { logout } from '../../lib/auth.js'

// Layout del backoffice: barra lateral izquierda (navegación) + área de contenido
// a la derecha. Cada sección lo usa como envoltorio: <AdminBar active="x">…</AdminBar>.
const ITEMS = [
  ['/admin/calendario', 'Calendario', 'calendario'],
  ['/admin/eventos', 'Eventos', 'eventos'],
  ['/admin/productos', 'Tienda', 'productos'],
  ['/admin/pedidos', 'Pedidos', 'pedidos'],
  ['/admin/suscripcion', 'Suscripción', 'suscripcion'],
  ['/admin/usuarios', 'Usuarios', 'usuarios'],
  ['/admin/consultas', 'Consultas', 'consultas'],
]

export default function AdminBar({ active, children }) {
  const nav = useNavigate()
  return (
    <div className="min-h-screen bg-piedra text-tinta flex">
      <aside className="w-52 sm:w-56 shrink-0 sticky top-0 h-screen bg-crema/95 backdrop-blur border-r border-tinta/10 flex flex-col">
        <div className="px-5 h-16 flex items-center border-b border-tinta/10">
          <span className="display text-lg leading-tight">Lucía Passardi</span>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-4 flex flex-col gap-1">
          {ITEMS.map(([to, label, key]) => (
            <Link key={key} to={to}
              className={`text-sm font-semibold px-3.5 py-2 rounded-xl transition-colors ${
                active === key ? 'bg-teal-600 text-crema' : 'text-tinta/65 hover:text-teal-600 hover:bg-teal-500/10'}`}>
              {label}
            </Link>
          ))}
        </nav>
        <div className="p-3 border-t border-tinta/10">
          <button onClick={() => { logout(); nav('/') }}
            className="w-full text-sm font-semibold px-3.5 py-2 rounded-xl text-tinta/60 hover:text-red-700 hover:bg-red-500/10 text-left transition-colors">
            Cerrar sesión
          </button>
        </div>
      </aside>
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  )
}
