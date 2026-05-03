import { useEffect, useState } from 'react'
import { getIdentity, isAdminRole } from '../lib/auth.js'
import EventModal, { deleteEvent } from './EventModal.jsx'
import ConfirmModal from './ConfirmModal.jsx'

const MONTHS_ES = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC']

function formatDate(iso) {
  const d = new Date(iso)
  return { month: MONTHS_ES[d.getMonth()], year: String(d.getFullYear()) }
}

export default function Hero() {
  // Columna derecha del Hero — lista resumida de eventos con CRUD inline
  // cuando el usuario es admin. La fuente de datos es la misma que la
  // sección AGENDA al final de la landing (`/api/aikikan/events`); las
  // mutaciones aquí refrescan la lista local y, al cambiar de ruta o
  // recargar, también la sección de abajo.
  const [events, setEvents]     = useState([])
  const [modalOpen, setModalOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState(null)

  const identity = getIdentity()
  const isAdmin  = identity && isAdminRole(identity.role)

  function load() {
    fetch('/api/aikikan/events')
      .then((r) => r.ok ? r.json() : [])
      .then((arr) => setEvents(Array.isArray(arr) ? arr : []))
      .catch(() => setEvents([]))
  }
  useEffect(load, [])

  async function confirmDelete() {
    if (!pendingDelete) return
    try { await deleteEvent(pendingDelete.id); load() }
    catch (err) { alert(err.message) }
  }

  return (
    <section id="hero">
      <div className="hero-bg-circle"></div>
      <div className="hero-glow"></div>
      <div className="hero-grid">

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

        <div className="hero-video-col">
          <div className="hero-video-frame">
            <video autoPlay muted loop playsInline>
              <source src="/hero.mp4" type="video/mp4" />
            </video>
            <div className="hero-video-overlay"></div>
          </div>
        </div>

        <div className="hero-events-col">
          <div className="section-label" style={{ marginBottom: '1rem' }}><span className="slash">/</span> Próximos Eventos</div>
          <div className="events-list" style={{ marginTop: 0 }}>
            {events.slice(0, isAdmin ? events.length : 4).map((e) => {
              const { month, year } = formatDate(e.date)
              return (
                <div key={e.id} className="event-row">
                  <div className="event-date">{month}<small>{year}</small></div>
                  <div>
                    <p className="event-name">{e.name}</p>
                    <p className="event-loc">{e.location}</p>
                  </div>
                  {isAdmin ? (
                    <button
                      onClick={() => setPendingDelete(e)}
                      className="event-trash"
                      title="Eliminar evento"
                      aria-label="Eliminar evento"
                    >×</button>
                  ) : (
                    <span className="event-arrow">→</span>
                  )}
                </div>
              )
            })}
          </div>
          {isAdmin ? (
            <button onClick={() => setModalOpen(true)} className="hero-event-more" style={{ background: 'none', border: 'none', textAlign: 'left', padding: 0 }}>
              <span className="slash">/</span> + Añadir evento
            </button>
          ) : (
            <a href="#eventos" className="hero-event-more"><span className="slash">/</span> Ver agenda completa</a>
          )}
        </div>
      </div>

      {modalOpen && (
        <EventModal
          onClose={() => setModalOpen(false)}
          onCreated={() => { setModalOpen(false); load() }}
        />
      )}
      {pendingDelete && (
        <ConfirmModal
          title="Eliminar evento"
          message={`¿Eliminar el evento "${pendingDelete.name}"? Esta acción no se puede deshacer.`}
          confirmLabel="Eliminar"
          onConfirm={confirmDelete}
          onClose={() => setPendingDelete(null)}
        />
      )}
    </section>
  )
}
