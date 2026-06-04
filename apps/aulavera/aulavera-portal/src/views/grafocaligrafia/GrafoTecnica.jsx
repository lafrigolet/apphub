import GrafoLayout from '../../components/grafocaligrafia/GrafoLayout'
import { escrituraSana } from '../../data/grafocaligrafia/intro'

export default function GrafoTecnica() {
  return (
    <GrafoLayout>
      <header className="page-header">
        <span className="eyebrow-script">Técnica escritural</span>
        <h1>La escritura <em>sana</em>.</h1>
        <p className="page-lead">
          Por qué cambiar los gestos de la escritura moviliza la corteza cerebral
          y reequilibra el organismo: la base neurofisiológica de la grafoterapia.
        </p>
      </header>

      <section className="section section-narrow">
        <div className="about-text">
          {escrituraSana.map((p, i) => <p key={i}>{p}</p>)}
        </div>

        <div className="grafo-two-col" style={{ marginTop: 56 }}>
          <figure className="grafo-figure" style={{ margin: 0 }}>
            <img src="/grafocaligrafia/img/forma-de-coger-el-boligrafo.jpg" alt="Forma correcta de coger el bolígrafo" />
            <figcaption>La forma correcta de coger el bolígrafo</figcaption>
          </figure>
          <figure className="grafo-figure" style={{ margin: 0 }}>
            <img src="/grafocaligrafia/img/mano-escribiendo.jpg" alt="Postura de la mano al escribir" />
            <figcaption>Postura y corporalización grafomotriz</figcaption>
          </figure>
        </div>
      </section>
    </GrafoLayout>
  )
}
