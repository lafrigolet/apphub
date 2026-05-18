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

import { useEffect, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { getIdentity, clearSession } from '../../lib/auth.js'
import { api } from '../../lib/api.js'

export default function ConsoleLayout({ children }) {
  const identity = getIdentity()
  const navigate = useNavigate()
  const [pendingCount, setPendingCount] = useState(0)

  // Contador de solicitudes pendientes mostrado como badge junto a
  // "Usuarios" en el sidebar. Lazy fetch al mount; no es crítico si falla.
  useEffect(() => {
    if (!identity?.tenantId) return
    const q = `appId=aikikan&tenantId=${encodeURIComponent(identity.tenantId)}&pending=approval`
    api('GET', `/api/users?${q}`)
      .then((arr) => setPendingCount(Array.isArray(arr) ? arr.length : 0))
      .catch(() => setPendingCount(0))
  }, [identity?.tenantId])

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
              <span>Usuarios</span>
              {pendingCount > 0 && (
                <span className="admin-sidebar-badge">{pendingCount}</span>
              )}
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
