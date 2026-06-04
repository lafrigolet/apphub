import { Link } from 'react-router-dom'
import GrafoLayout from '../../components/grafocaligrafia/GrafoLayout'
import { zurdos } from '../../data/grafocaligrafia/intro'

export default function GrafoZurdos() {
  return (
    <GrafoLayout>
      <header className="page-header">
        <span className="eyebrow-script">Guía para zurdos</span>
        <h1>Escritura <em>fácil</em> para zurdos.</h1>
        <p className="page-lead">
          Con mano izquierda, giremos la tendencia: técnica grafomotora específica
          para que escribir con la zurda sea legible, fluido y placentero.
        </p>
      </header>

      <section className="section section-narrow">
        <blockquote>{zurdos.cita}</blockquote>
        <p style={{ color: 'var(--ink-soft)' }}>
          Del libro <strong>{zurdos.libro.titulo}</strong> ({zurdos.libro.editorial}).
        </p>
        <p style={{ color: 'var(--ink-soft)' }}>
          En la sección de <Link to="/grafocaligrafia/recursos" style={{ color: 'var(--grafo-accent)' }}>recursos</Link>{' '}
          encontrarás la primera sesión específica para zurdos en PDF, y el curso
          profesional cubre la técnica grafomotora correcta tanto para la mano
          derecha como para la izquierda.
        </p>
      </section>
    </GrafoLayout>
  )
}
