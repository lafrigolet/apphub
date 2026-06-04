import { NavLink } from 'react-router-dom'

const links = [
  { to: '/grafocaligrafia', label: 'Quiénes somos', end: true },
  { to: '/grafocaligrafia/tecnica', label: 'Técnica escritural' },
  { to: '/grafocaligrafia/metodo', label: 'El método' },
  { to: '/grafocaligrafia/zurdos', label: 'Guía para zurdos' },
  { to: '/grafocaligrafia/recursos', label: 'Recursos' },
  { to: '/grafocaligrafia/curso', label: 'Curso profesional' },
]

export default function GrafoNav() {
  return (
    <nav className="grafo-nav" aria-label="Secciones de Grafocaligrafía Racional">
      {links.map((l) => (
        <NavLink
          key={l.to}
          to={l.to}
          end={l.end}
          className={({ isActive }) => (isActive ? 'is-active' : '')}
        >
          {l.label}
        </NavLink>
      ))}
    </nav>
  )
}
