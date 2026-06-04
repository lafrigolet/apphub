import { Link } from 'react-router-dom'
import GrafoNav from './GrafoNav'
import { marca } from '../../data/grafocaligrafia/intro'

// Cabecera de marca + sub-nav. La sección Grafocaligrafía Racional mantiene
// identidad propia (autoría Juanjo Vara / linaje Vicente Lledó) dentro de
// aulavera — todo el contenido va envuelto en el scope visual `.grafo`.
export default function GrafoLayout({ children }) {
  return (
    <div className="grafo">
      <header className="grafo-masthead">
        <div className="grafo-masthead-inner">
          <p className="grafo-breadcrumb">
            <Link to="/">AulaVera</Link> › <Link to="/proyectos">Disciplinas</Link> › Grafocaligrafía
          </p>
          <div className="grafo-brand">
            <img src={marca.logo} alt="Logo de los doce trazos" />
            <div>
              <div className="grafo-brand-name">{marca.nombre}</div>
              <div className="grafo-brand-sub">
                <span className="script">método de {marca.autor}</span> · {marca.linaje}
              </div>
            </div>
          </div>
          <GrafoNav />
        </div>
      </header>
      {children}
    </div>
  )
}
