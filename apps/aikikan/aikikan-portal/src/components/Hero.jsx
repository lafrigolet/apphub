import { events } from '../data/events.js'

export default function Hero() {
  return (
    <section id="hero">
      <div className="hero-bg-circle"></div>
      <div className="hero-glow"></div>
      <div className="hero-grid">

        {/* ── Left: title + quote + stats ── */}
        <div className="hero-left">
          <p className="hero-eyebrow"><span className="slash">/</span> Asociación Nacional · Aikido</p>
          <h1 className="hero-title">AIKI<span className="accent">KAN</span>ESPAÑA</h1>
          <blockquote className="hero-quote">
            "En aikido no hay formas ni modelos. Los movimientos naturales son los movimientos del aikido. Su profundidad es insondable e inagotable."
            <cite>/ O'SENSEI MORIHEI UESHIBA</cite>
          </blockquote>
          <div className="hero-meta">
            <div><div className="hero-stat-num">46+</div><div className="hero-stat-label">Dojos</div></div>
            <div><div className="hero-stat-num">IAF</div><div className="hero-stat-label">Afiliación</div></div>
            <div><div className="hero-stat-num">EAF</div><div className="hero-stat-label">Europea</div></div>
          </div>
        </div>

        {/* ── Center: video ── */}
        <div className="hero-video-col">
          <div className="hero-video-frame">
            <video autoPlay muted loop playsInline>
              <source src="/hero.mp4" type="video/mp4" />
            </video>
            <div className="hero-video-overlay"></div>
          </div>
        </div>

        {/* ── Right: events agenda ── */}
        <div className="hero-events-col">
          <div className="section-label" style={{ marginBottom: '1rem' }}><span className="slash">/</span> Próximos Eventos</div>
          <div className="events-list" style={{ marginTop: 0 }}>
            {events.map((e, i) => (
              <div key={i} className="event-row">
                <div className="event-date">{e.date}<small>{e.year}</small></div>
                <div>
                  <p className="event-name">{e.name}</p>
                  <p className="event-loc">{e.loc}</p>
                </div>
                <span className="event-arrow">→</span>
              </div>
            ))}
          </div>
          <a href="#eventos" className="hero-event-more"><span className="slash">/</span> Ver agenda completa</a>
        </div>
      </div>
    </section>
  )
}
