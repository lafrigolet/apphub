import { Link } from 'react-router-dom'

// Nav fija. Composición idéntica en todas las rutas:
//   - anchors de marketing apuntan a `/#hash` — funcionan tanto en / (sólo
//     scroll) como en /consola o /area-socio (cambian de ruta a / y luego
//     scrollean al ancla; el scroll lo dispara un useEffect en App.jsx).
//   - cuando hay sesión aparece un link extra: /consola para admin,
//     /area-socio para socio.
//   - "Acceder" se transforma en email + "Salir".
const ADMIN_ROLES = new Set(['owner', 'admin', 'staff', 'super_admin'])

export default function Nav({ onLoginOpen, identity, onLogout }) {
  const isAdmin  = identity && ADMIN_ROLES.has(identity.role)
  const isMember = identity && !isAdmin

  return (
    <nav>
      <div className="nav-logo">AIKIKAN<span> /</span> ES</div>
      <ul className="nav-links">
        <li><Link to="/#hero">Inicio</Link></li>
        <li><Link to="/#about">Asociación</Link></li>
        <li><Link to="/#maestros">Maestros</Link></li>
        <li><Link to="/#videos">Vídeos</Link></li>
        <li><Link to="/#dojos">Dojos</Link></li>
        <li><Link to="/#contacto">Contacto</Link></li>
        {isAdmin  && <li><Link to="/consola">Consola</Link></li>}
        {isMember && <li><Link to="/area-socio">Mi área</Link></li>}
      </ul>
      <div className="nav-actions">
        {identity ? (
          <>
            <span className="nav-user">{identity.email}</span>
            <button className="nav-login" onClick={onLogout}>Salir</button>
          </>
        ) : (
          <button className="nav-login" onClick={onLoginOpen}>Acceder</button>
        )}
        <a href="mailto:secretaria@aikikan.es" className="nav-cta">Contáctenos</a>
      </div>
    </nav>
  )
}
