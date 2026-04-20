export default function Nav() {
  return (
    <nav>
      <div className="nav-logo">AIKIKAN<span> /</span> ES</div>
      <ul className="nav-links">
        <li><a href="#hero">Inicio</a></li>
        <li><a href="#about">Asociación</a></li>
        <li><a href="#maestros">Maestros</a></li>
        <li><a href="#videos">Vídeos</a></li>
        <li><a href="#dojos">Dojos</a></li>
        <li><a href="#contacto">Contacto</a></li>
      </ul>
      <a href="mailto:secretaria@aikikan.es" className="nav-cta">Contáctenos</a>
    </nav>
  )
}
