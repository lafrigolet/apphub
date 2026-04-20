import { useState, useMemo } from 'react'
import { dojos } from '../data/dojos.js'

export default function Dojos() {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim()
    if (!q) return dojos
    return dojos.filter(d =>
      d.name.toLowerCase().includes(q) ||
      d.city.toLowerCase().includes(q) ||
      d.province.toLowerCase().includes(q) ||
      (d.sensei && d.sensei.toLowerCase().includes(q))
    )
  }, [query])

  return (
    <section id="dojos">
      <div className="dojos-header reveal">
        <div>
          <div className="section-label"><span className="slash">/</span> Red de Dojos</div>
          <h2 className="section-title">LOS<br />DOJOS</h2>
        </div>
        <span className="mono" style={{ fontSize: '.75rem', letterSpacing: '.15em', color: 'rgba(9,9,8,.28)', paddingBottom: '.5rem' }}>[ {dojos.length} ]</span>
      </div>

      <div className="dojos-search reveal">
        <span className="dojos-search-icon"><span className="slash">/</span></span>
        <input
          type="text"
          className="dojos-search-input"
          placeholder="Buscar por dojo, ciudad, provincia o sensei…"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        {query && (
          <span className="dojos-search-count">
            {filtered.length} resultado{filtered.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {filtered.length > 0 ? (
        <div className="dojo-grid">
          {filtered.map((d, i) => (
            <div key={i} className="dojo-card">
              <p className="dojo-region">{d.province}</p>
              <h3 className="dojo-name">{d.name}</h3>
              <p className="dojo-city">{d.city}</p>
              {d.address && <p className="dojo-address">{d.address}</p>}
              {d.sensei  && <p className="dojo-sensei"><span className="slash">/</span> {d.sensei}</p>}
              <div className="dojo-contacts">
                {d.phone && <a href={`tel:${d.phone.replace(/\s/g,'')}`} className="dojo-contact-item">{d.phone}</a>}
                {d.email && <a href={`mailto:${d.email}`} className="dojo-contact-item">{d.email}</a>}
                {d.web   && <a href={`https://${d.web}`} target="_blank" rel="noreferrer" className="dojo-contact-item">{d.web}</a>}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="dojos-empty">/ No se encontraron dojos para "{query}"</p>
      )}
    </section>
  )
}
