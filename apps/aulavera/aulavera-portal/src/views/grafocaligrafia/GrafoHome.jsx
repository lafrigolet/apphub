import { Link } from 'react-router-dom'
import GrafoLayout from '../../components/grafocaligrafia/GrafoLayout'
import { marca, bio } from '../../data/grafocaligrafia/intro'

export default function GrafoHome() {
  return (
    <GrafoLayout>
      <header className="page-header">
        <span className="eyebrow-script">¡Hola!</span>
        <h1>La escritura consciente,<br /><em>herramienta de autoconocimiento</em>.</h1>
        <p className="page-lead">
          {marca.claim}. Una disciplina consolidada del área de Educación de AulaVera,
          de la mano de {marca.autor}, {marca.linaje}.
        </p>
      </header>

      <section className="section section-narrow">
        <figure className="grafo-figure" style={{ margin: '0 auto', maxWidth: 720 }}>
          <img src="/grafocaligrafia/img/mano-escribiendo.jpg" alt="Mano escribiendo con técnica grafomotriz" />
          <figcaption>Presentación básica de la grafoterapia para formadores</figcaption>
        </figure>
        <div className="about-text" style={{ marginTop: 40 }}>
          {bio.map((p, i) => <p key={i}>{p}</p>)}
          <p style={{ marginTop: 28 }}>
            <Link to="/grafocaligrafia/metodo" className="btn btn-grafo">Conoce el método de los 12 trazos →</Link>
          </p>
        </div>
      </section>

      <section className="section section-narrow" style={{ paddingTop: 0 }}>
        <h2 style={{ marginBottom: 24 }}>Consultas y talleres</h2>
        <p style={{ color: 'var(--ink-soft)' }}>
          {marca.autor} pasa consultas y da talleres entre Madrid y Guadalajara, y colabora
          con AulaVera en la disciplina de grafomotricidad y reeducación escritural.
          Para pedir cita: <a href={`mailto:${marca.email}`} style={{ color: 'var(--grafo-accent)' }}>{marca.email}</a> · {marca.telefono}.
        </p>
        <p style={{ color: 'var(--ink-mute)', fontStyle: 'italic' }}>
          Contenido reproducido con permiso desde{' '}
          <a href={marca.webOriginal} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--grafo-accent)' }}>
            grafocaligrafiaracional.com
          </a>.
        </p>
      </section>
    </GrafoLayout>
  )
}
