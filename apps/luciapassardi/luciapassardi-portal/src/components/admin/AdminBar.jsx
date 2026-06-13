import { Link, useNavigate } from 'react-router-dom'
import { logout } from '../../lib/auth.js'

// Barra fina común a las páginas de admin propias del portal (la consola
// embebida + la sección de Eventos).
export default function AdminBar({ active }) {
  const nav = useNavigate()
  const link = (to, label, key) => (
    <Link to={to}
      className={`text-sm font-semibold px-3 py-1.5 rounded-full transition-colors ${
        active === key ? 'bg-teal-600 text-crema' : 'text-tinta/60 hover:text-teal-600'}`}>
      {label}
    </Link>
  )
  return (
    <div className="sticky top-0 z-40 bg-crema/90 backdrop-blur border-b border-tinta/10">
      <div className="max-w-7xl mx-auto px-5 h-14 flex items-center justify-between">
        <span className="display text-xl">Lucía Passardi · Consola</span>
        <nav className="flex items-center gap-1.5">
          {link('/admin', 'Consola', 'consola')}
          {link('/admin/calendario', 'Calendario', 'calendario')}
          {link('/admin/eventos', 'Eventos', 'eventos')}
          {link('/admin/productos', 'Tienda', 'productos')}
          {link('/admin/pedidos', 'Pedidos', 'pedidos')}
          <button onClick={() => { logout(); nav('/') }}
            className="text-sm font-semibold px-3 py-1.5 rounded-full text-tinta/60 hover:text-red-700">
            Cerrar sesión
          </button>
        </nav>
      </div>
    </div>
  )
}
