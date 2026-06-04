import GrafoLayout from '../../components/grafocaligrafia/GrafoLayout'
import YouTubeEmbed from '../../components/grafocaligrafia/YouTubeEmbed'
import RecursoLink from '../../components/grafocaligrafia/RecursoLink'
import { videos, categoriasVideo } from '../../data/grafocaligrafia/videos'
import { articulos } from '../../data/grafocaligrafia/articulos'
import { descargables } from '../../data/grafocaligrafia/descargables'

export default function GrafoRecursos() {
  return (
    <GrafoLayout>
      <header className="page-header">
        <span className="eyebrow-script">Recursos</span>
        <h1>Vídeos, artículos y <em>descargables</em>.</h1>
        <p className="page-lead">
          Material audiovisual del método, lecturas externas seleccionadas y
          plantillas para empezar a practicar.
        </p>
      </header>

      <section className="section">
        <h2>Vídeos</h2>
        {categoriasVideo.map((cat) => (
          <div key={cat.id}>
            <h3 style={{ marginTop: 40 }}>{cat.label}</h3>
            <div className="videos-grid">
              {videos.filter((v) => v.categoria === cat.id).map((v) => (
                <YouTubeEmbed key={v.id} id={v.id} title={v.title} />
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="section section-narrow">
        <h2>Descargables</h2>
        <div className="recursos-lista">
          {descargables.map((d) => (
            <RecursoLink key={d.title} tipo={d.type} title={d.title} href={d.file} meta={d.size} download />
          ))}
        </div>
      </section>

      <section className="section section-narrow" style={{ paddingTop: 0 }}>
        <h2>Artículos de interés</h2>
        <p style={{ color: 'var(--ink-mute)', fontStyle: 'italic' }}>
          Enlaces externos seleccionados por el autor — se abren en el medio original.
        </p>
        <div className="recursos-lista">
          {articulos.map((a) => (
            <RecursoLink key={a.url} tipo="Leer" title={a.title} href={a.url} meta={a.source} />
          ))}
        </div>
      </section>
    </GrafoLayout>
  )
}
