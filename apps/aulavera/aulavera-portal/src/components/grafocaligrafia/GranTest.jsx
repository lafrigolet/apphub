import { instrucciones, claveCompleta, facultades, trazosDeFacultad } from '../../data/grafocaligrafia/granTest'

// V1 estático: leyenda explicativa de la clave A-L / 1-12 y las tres
// grandes facultades. La auto-evaluación interactiva queda para V2 si el
// autor facilita el algoritmo de interpretación (propiedad intelectual).
export default function GranTest() {
  return (
    <section className="gran-test" aria-labelledby="gran-test-title">
      <span className="eyebrow-script">El Gran Test grafológico</span>
      <h2 id="gran-test-title">Las tres grandes facultades</h2>
      <p style={{ color: 'var(--ink-soft)', marginTop: 16 }}>{instrucciones}</p>
      <div className="gran-test-clave">
        {claveCompleta.letras.join(' ')} · {claveCompleta.numeros.join(' ')}
      </div>
      <div className="facultades-grid">
        {facultades.map((f) => (
          <article className="facultad-card" key={f.id}>
            <h3>{f.nombre}</h3>
            <div className="facultad-clave">
              {f.letras} / {f.numeros.join(', ')}
            </div>
            <p>{f.descripcion}</p>
            <div className="trazos-mini">
              {trazosDeFacultad(f.id).map((t) => `${t.n}. ${t.nombre}`).join(' · ')}
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
