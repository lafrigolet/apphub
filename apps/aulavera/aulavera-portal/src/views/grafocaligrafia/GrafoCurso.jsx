import GrafoLayout from '../../components/grafocaligrafia/GrafoLayout'
import CursoInscripcion from '../../components/grafocaligrafia/CursoInscripcion'
import { curso } from '../../data/grafocaligrafia/curso'

export default function GrafoCurso() {
  return (
    <GrafoLayout>
      <header className="page-header">
        <span className="eyebrow-script">Formación</span>
        <h1>Curso <em>profesional</em> de Grafología Racional.</h1>
        <p className="page-lead">{curso.intro}</p>
      </header>

      <section className="section section-narrow" style={{ paddingBottom: 0 }}>
        <h2 style={{ marginBottom: 24 }}>Aprenderás a ver</h2>
        <ul style={{ color: 'var(--ink-soft)', paddingLeft: 22, display: 'grid', gap: 10 }}>
          {curso.objetivos.map((o, i) => <li key={i}>{o}</li>)}
        </ul>
      </section>

      <section className="section section-narrow" style={{ paddingBottom: 0 }}>
        <h2 style={{ marginBottom: 24 }}>Este curso es para ti si…</h2>
        <div className="facultades-grid">
          {curso.destinatarios.map((d) => (
            <article className="facultad-card" key={d.perfil}>
              <h3 style={{ fontSize: '1.15rem' }}>{d.perfil}</h3>
              <p>{d.texto}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section section-narrow">
        <h2 style={{ marginBottom: 24 }}>Reserva tu plaza</h2>
        <CursoInscripcion />
      </section>
    </GrafoLayout>
  )
}
