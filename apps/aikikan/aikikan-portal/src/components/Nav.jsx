import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

// Nav fija. Composición idéntica en todas las rutas:
//   - anchors de marketing apuntan a `/#hash` — funcionan tanto en / (sólo
//     scroll) como en /consola o /area-socio (cambian de ruta a / y luego
//     scrollean al ancla; el scroll lo dispara un useEffect en App.jsx).
//   - cuando hay sesión aparece un link extra: /consola para admin,
//     /area-socio para socio.
//   - "Acceder" se transforma en email + "Salir".
//   - En móvil (≤900px) los links + acciones se ocultan detrás del botón
//     hamburguesa y se despliegan como overlay full-screen al toggle.
const ADMIN_ROLES = new Set(['owner', 'admin', 'staff', 'super_admin'])

export default function Nav({ onLoginOpen, identity, onLogout }) {
  const [open, setOpen] = useState(false)
  const isAdmin  = identity && ADMIN_ROLES.has(identity.role)
  const isMember = identity && !isAdmin
  const close = () => setOpen(false)

  // Bloquear el scroll del body mientras el menú móvil está abierto.
  useEffect(() => {
    if (typeof document === 'undefined') return
    const prev = document.body.style.overflow
    document.body.style.overflow = open ? 'hidden' : prev
    return () => { document.body.style.overflow = prev }
  }, [open])

  return (
    <nav className={open ? 'is-open' : ''}>
      <div className="nav-logo">AIKIKAN<span> /</span> ES</div>

      <button
        type="button"
        className={`nav-burger ${open ? 'is-open' : ''}`}
        aria-label={open ? 'Cerrar menú' : 'Abrir menú'}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span></span><span></span><span></span>
      </button>

      <ul className={`nav-links ${open ? 'is-open' : ''}`}>
        <li><Link to="/#hero"     onClick={close}>Inicio</Link></li>
        <li><Link to="/#about"    onClick={close}>Asociación</Link></li>
        <li><Link to="/#maestros" onClick={close}>Maestros</Link></li>
        <li><Link to="/#videos"   onClick={close}>Vídeos</Link></li>
        <li><Link to="/#eventos"  onClick={close}>Agenda</Link></li>
        <li><Link to="/#dojos"    onClick={close}>Dojos</Link></li>
        <li><Link to="/#contacto" onClick={close}>Contacto</Link></li>
        {isAdmin  && <li><Link to="/consola"    onClick={close}>Consola</Link></li>}
        {isMember && <li><Link to="/area-socio" onClick={close}>Mi área</Link></li>}
      </ul>
      <div className={`nav-actions ${open ? 'is-open' : ''}`}>
        {identity ? (
          <>
            <span className="nav-user">{identity.email}</span>
            <button className="nav-login" onClick={() => { close(); onLogout() }}>Salir</button>
          </>
        ) : (
          <button className="nav-login" onClick={() => { close(); onLoginOpen() }}>Acceder</button>
        )}
        <a href="mailto:secretaria@aikikan.es" className="nav-cta" onClick={close}>Contáctenos</a>
      </div>
    </nav>
  )
}
