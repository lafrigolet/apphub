import { Link } from 'react-router-dom'
import { collaborators } from '../data/mock'

export default function Footer() {
  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <div className="collaborators">
          <div className="lbl">Caminamos junto a</div>
          <div className="collab-row">
            {collaborators.map((c) => (
              <a key={c} href="#" className="collab" rel="noopener" target="_blank">{c}</a>
            ))}
          </div>
        </div>

        <div className="footer-top">
          <div className="footer-brand">
            <div className="brand-name">AulaVera</div>
            <p>Educación medioambiental, creativa y de desarrollo personal — al aire libre, en una finca rústica de Losar de la Vera, Cáceres.</p>
          </div>
          <div className="footer-col">
            <h5>Explorar</h5>
            <ul>
              <li><Link to="/">Qué es AulaVera</Link></li>
              <li><Link to="/areas">Las 4 áreas</Link></li>
              <li><Link to="/proyectos">Proyectos</Link></li>
              <li><Link to="/proyectos">Áreas de acción</Link></li>
            </ul>
          </div>
          <div className="footer-col">
            <h5>Apoya</h5>
            <ul>
              <li><Link to="/donar">Donaciones</Link></li>
              <li><Link to="/donar">Hacerse socio</Link></li>
              <li><Link to="/contacto">Voluntariado</Link></li>
              <li><Link to="/privada">Área privada</Link></li>
            </ul>
          </div>
          <div className="footer-col">
            <h5>Contacto</h5>
            <ul>
              <li>Finca rústica de Losar de la Vera</li>
              <li>Cáceres · Extremadura</li>
              <li><a href="mailto:hola@aulavera.org">hola@aulavera.org</a></li>
              <li><Link to="/contacto">Visítanos</Link></li>
            </ul>
          </div>
        </div>

        <div className="footer-bottom">
          <div>© 2026 Fundación AulaVera — antes Fundación SmileStone (2013).</div>
          <div>
            <a href="#">Aviso legal</a>
            <a href="#">Privacidad</a>
            <a href="#">Cookies</a>
          </div>
        </div>
      </div>
    </footer>
  )
}
