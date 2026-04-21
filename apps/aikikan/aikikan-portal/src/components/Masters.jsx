import { useState, useEffect } from 'react'
import { masters } from '../data/masters.js'
import MasterModal from './MasterModal.jsx'

export default function Masters() {
  const [activeMaster, setActiveMaster] = useState(null)

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') setActiveMaster(null) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    document.body.style.overflow = activeMaster ? 'hidden' : ''
  }, [activeMaster])

  return (
    <section id="maestros">
      <div className="masters-intro">
        <div className="reveal">
          <div className="section-label"><span className="slash">/</span> Linaje &amp; Maestros</div>
          <h2 className="section-title">LOS<br />MAESTROS</h2>
        </div>
        <p className="masters-intro-body reveal">La transmisión del Aikido a través de generaciones de maestros constituye la columna vertebral de nuestra práctica. Cada sensei porta el conocimiento recibido directamente del fundador, preservando la esencia del camino.</p>
      </div>

      <div className="masters-grid stagger">
        {Object.entries(masters).map(([key, m]) => (
          <div key={key} className="master-card" data-master={key} onClick={() => setActiveMaster(m)}>
            <div className="master-portrait">
              <img src={m.img} alt={m.name} loading="lazy" onError={e => { e.target.parentElement.style.background = '#1a1208' }} />
              <div className="master-portrait-overlay"></div>
            </div>
            <div className="master-info">
              <p className="master-rank">{m.rank}</p>
              <h3 className="master-name">{m.name}</h3>
              <p className="master-years">{m.years.split(' · ')[0]}</p>
              <p className="master-bio">{m.body.substring(0, 160)}…</p>
            </div>
          </div>
        ))}
      </div>
      <p className="master-hint">/ HAZ CLIC EN CADA MAESTRO PARA SABER MÁS</p>

      {activeMaster && <MasterModal master={activeMaster} onClose={() => setActiveMaster(null)} />}
    </section>
  )
}
