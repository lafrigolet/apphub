// Layout compartido para las vistas nativas de la consola admin de
// aikikan-portal. Provee el chrome (header + sidebar) y deja el slot
// `children` para el contenido específico.
//
// El sidebar tiene entradas hardcodeadas — replican lo que el shell
// embebido (TenantAdminShell montado en /consola) muestra hoy. Cuando
// el admin entra en /consola/usuarios o /consola/billing, el sidebar
// sigue visible y consistente.
//
// Para volver al shell embebido (con sus categorías/módulos cargados
// del backend), el item "Inicio" navega a /consola exact.

import { NavLink, useNavigate } from 'react-router-dom'
import { getIdentity, clearSession } from '../../lib/auth.js'

export default function ConsoleLayout({ children }) {
  const identity = getIdentity()
  const navigate = useNavigate()

  function logout() {
    clearSession()
    navigate('/', { replace: true })
  }

  return (
    <div className="admin-consola">
      <header className="admin-header">
        <div className="admin-header-logo">AIKI<span>KAN</span> · CONSOLA</div>
        <div className="admin-header-right">
          <span className="admin-header-user">{identity?.email} · {identity?.role}</span>
          <button className="admin-header-logout" onClick={logout}>Cerrar sesión</button>
        </div>
      </header>

      <div className="admin-layout">
        <aside className="admin-sidebar">
          <nav>
            <NavLink end to="/consola" className={({ isActive }) => `admin-sidebar-item${isActive ? ' active' : ''}`}>
              Inicio
            </NavLink>

            <div className="admin-sidebar-category">Operaciones</div>
            <NavLink to="/consola/usuarios" className={({ isActive }) => `admin-sidebar-item${isActive ? ' active' : ''}`}>
              Usuarios
            </NavLink>

            <div className="admin-sidebar-category">Negocio</div>
            <NavLink to="/consola/billing" className={({ isActive }) => `admin-sidebar-item${isActive ? ' active' : ''}`}>
              Billing
            </NavLink>
          </nav>
        </aside>

        <main className="admin-main">
          {children}
        </main>
      </div>
    </div>
  )
}
