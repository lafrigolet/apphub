import { useState } from 'react'
import { NavLink, Link } from 'react-router-dom'

const links = [
  { to: '/', label: 'Inicio', end: true },
  { to: '/areas', label: 'Áreas' },
  { to: '/proyectos', label: 'Proyectos' },
  { to: '/grafocaligrafia', label: 'Grafocaligrafía' },
  { to: '/contacto', label: 'Contacto' },
  { to: '/privada', label: 'Área privada' },
]

export default function Nav() {
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)

  return (
    <header className="site-nav">
      <div className="nav-inner">
        <Link to="/" className="brand" onClick={close}>
          <div className="brand-mark"><span>A</span></div>
          <div>
            <div className="brand-name">AulaVera</div>
            <div className="brand-sub">Fundación · Granja Escuela</div>
          </div>
        </Link>
        <button className="nav-toggle" aria-label="Menú" onClick={() => setOpen((v) => !v)}>≡</button>
        <ul className={`nav-links${open ? ' is-open' : ''}`}>
          {links.map((l) => (
            <li key={l.to}>
              <NavLink
                to={l.to}
                end={l.end}
                onClick={close}
                className={({ isActive }) => (isActive ? 'is-active' : '')}
              >
                {l.label}
              </NavLink>
            </li>
          ))}
          <li>
            <Link to="/donar" className="nav-cta" onClick={close}>Donar</Link>
          </li>
        </ul>
      </div>
    </header>
  )
}
