const GRUPO_LABEL = {
  inteligencia: 'Inteligencia',
  sentimiento: 'Sentimiento',
  voluntad: 'Voluntad',
}

export default function TrazoCard({ trazo }) {
  return (
    <article className="trazo-card" id={`trazo-${trazo.id}`}>
      <div className="trazo-card-head">
        <img src={trazo.img} alt={`Trazo «${trazo.trazo}»`} loading="lazy" />
        <div>
          <div className="trazo-num">Trazo {trazo.n}</div>
          <h3>{trazo.nombre}</h3>
          <div className="trazo-dir">{trazo.trazo}</div>
        </div>
      </div>
      <span className="trazo-grupo">{GRUPO_LABEL[trazo.grupo]}</span>
      <p className="trazo-intro">{trazo.intro}</p>
      <p className="trazo-pregunta">{trazo.pregunta}</p>
      <details className="trazo-detalle">
        <summary>Temperatura y esencias</summary>
        <h5>Temperatura</h5>
        <ul>
          <li><span className="clave">-{trazo.n}/M</span>{trazo.temperatura.M}</li>
          <li><span className="clave">-{trazo.n}/P</span>{trazo.temperatura.P}</li>
        </ul>
        <h5>Esencias principales bien hechas</h5>
        <ul>
          {trazo.esenciasBien.map((e) => (
            <li key={e.clave}><span className="clave">{e.clave}</span>{e.texto}</li>
          ))}
        </ul>
        <h5>Esencias principales mal hechas</h5>
        <ul>
          {trazo.esenciasMal.map((e) => (
            <li key={e.clave}><span className="clave">{e.clave}</span>{e.texto}</li>
          ))}
        </ul>
      </details>
    </article>
  )
}
