import GrafoLayout from '../../components/grafocaligrafia/GrafoLayout'
import TrazoCard from '../../components/grafocaligrafia/TrazoCard'
import GranTest from '../../components/grafocaligrafia/GranTest'
import { trazos } from '../../data/grafocaligrafia/trazos'
import { analisisGrafologico } from '../../data/grafocaligrafia/intro'

export default function GrafoMetodo() {
  return (
    <GrafoLayout>
      <header className="page-header">
        <span className="eyebrow-script">El método</span>
        <h1>Los <em>doce trazos</em> de la escritura.</h1>
        <p className="page-lead">
          La Grafología Racional estudia el trazo como unidad de observación en sí
          misma: doce funciones psicológicas, cada una con su temperatura y sus
          esencias bien o mal hechas.
        </p>
      </header>

      <section className="section section-narrow" style={{ paddingBottom: 0 }}>
        <h2 style={{ marginBottom: 20 }}>El análisis grafológico</h2>
        <p style={{ color: 'var(--ink-soft)' }}>{analisisGrafologico}</p>
        <figure className="grafo-figure" style={{ margin: '40px auto 0', maxWidth: 720 }}>
          <img src="/grafocaligrafia/img/doce-trazos.jpg" alt="Los doce trazos posibles de la escritura" />
          <figcaption>Los doce trazos posibles de la escritura</figcaption>
        </figure>
      </section>

      <section className="section">
        <div className="trazos-grid">
          {trazos.map((t) => <TrazoCard key={t.id} trazo={t} />)}
        </div>
        <GranTest />
      </section>
    </GrafoLayout>
  )
}
