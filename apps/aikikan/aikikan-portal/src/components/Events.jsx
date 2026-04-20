import { events } from '../data/events.js'

export default function Events() {
  return (
    <section id="eventos">
      <div className="section-label reveal"><span className="slash">/</span> Próximos Eventos</div>
      <h2 className="section-title reveal">AGENDA<br />2025–2026</h2>
      <div className="events-list">
        {events.map((e, i) => (
          <div key={i} className="event-row reveal">
            <div className="event-date">{e.date}<small>{e.year}</small></div>
            <div>
              <p className="event-name">{e.name}</p>
              <p className="event-loc">{e.loc}</p>
            </div>
            <span className="event-arrow">→</span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: '2.5rem' }} className="reveal">
        <a href="https://www.aikikan.es/events" className="btn-outline"><span className="slash">/</span> Ver todos los eventos</a>
      </div>
    </section>
  )
}
