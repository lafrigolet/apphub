import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Poem from '../components/Poem'
import ReserveModal from '../components/ReserveModal'
import { Workshop, Cow, Vega, Olives, River, Frog } from '../components/svg/Illustrations'
import { ideas } from '../data/mock'
import { aulavera } from '../lib/api'
import { useToast } from '../components/Toast'

const imgMap = { workshop: Workshop, cow: Cow, vega: Vega, olives: Olives, river: River, frog: Frog }

const elAlquimista = `Es justamente la posibilidad de realizar un sueño
lo que hace que la vida sea interesante.
El miedo a sufrir es peor que el propio sufrimiento.`

function Chronicle({ event }) {
  const Img = imgMap[event.image_key] ?? Workshop
  const paragraphs = (event.body ?? '').split('\n\n')
  return (
    <article className="chronicle">
      <div className="img"><Img /></div>
      <div>
        <span className="when">{event.when_text}</span>
        <h2>{event.title}</h2>
        {event.quote && <blockquote>{event.quote}</blockquote>}
        {paragraphs.map((p, i) => <p key={i}>{p}</p>)}
        {event.tags?.length > 0 && (
          <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
            {event.tags.map((t) => <span key={t} className="tag">{t}</span>)}
          </div>
        )}
      </div>
    </article>
  )
}

function Realizados({ events, loading }) {
  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-mute)', fontStyle: 'italic' }}>Cargando…</div>
  if (events.length === 0) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-mute)', fontStyle: 'italic' }}>Aún no hay crónicas publicadas.</div>
  return <>{events.map((e) => <Chronicle key={e.id} event={e} />)}</>
}

function Futuros({ events, loading, onReserve }) {
  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-mute)', fontStyle: 'italic' }}>Cargando…</div>
  return (
    <>
      <div className="projects-grid">
        {events.map((it) => {
          const Img = imgMap[it.image_key] ?? Workshop
          return (
            <article key={it.id} className="project-card">
              <div className="project-img">
                <Img />
                <span className="chip">{it.area}</span>
              </div>
              <div className="project-body">
                <span className="when">{it.when_text}</span>
                <h3>{it.title}</h3>
                <p>{it.body}</p>
                <div className="meta">
                  <span>Plazas limitadas · alojamiento opcional</span>
                  <a onClick={(e) => { e.preventDefault(); onReserve(it) }}>{it.price_label} →</a>
                </div>
              </div>
            </article>
          )
        })}
      </div>

      <div className="ideas-cloud">
        <div className="label">Lluvia de ideas para la sección</div>
        <div className="ideas-tags">
          {ideas.map((t) => <span key={t} className="tag">{t}</span>)}
        </div>
      </div>
    </>
  )
}

function AreasAccion({ disciplines, loading }) {
  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-mute)', fontStyle: 'italic' }}>Cargando…</div>
  return (
    <div className="projects-grid">
      {disciplines.map((d) => (
        <article key={d.id} className="project-card">
          <div className="project-body" style={{ padding: 32 }}>
            <div style={{ fontSize: '2rem', color: 'var(--terra)', marginBottom: 12 }}>{d.icon}</div>
            <h3>{d.name}</h3>
            <p>{d.body}</p>
            <div className="meta">
              <span className={`tag ${d.state === 'Consolidada' ? 'featured' : ''}`}>{d.state}</span>
              {/* La disciplina de grafomotricidad tiene sección propia con marca Grafocaligrafía Racional */}
              <Link to={/grafo/i.test(d.name) ? '/grafocaligrafia' : '/contacto'}>Saber más →</Link>
            </div>
          </div>
        </article>
      ))}
    </div>
  )
}

export default function Proyectos() {
  const [tab, setTab] = useState('realizados')
  const [reserveItem, setReserveItem] = useState(null)
  const [realizados, setRealizados] = useState([])
  const [futuros, setFuturos] = useState([])
  const [disciplines, setDisciplines] = useState([])
  const [loading, setLoading] = useState({ realizados: true, futuros: true, disciplines: true })
  const showToast = useToast()

  useEffect(() => {
    aulavera.listEvents('chronicle')
      .then((rows) => setRealizados(rows ?? []))
      .catch((err) => showToast(`Error al cargar realizados: ${err.message}`))
      .finally(() => setLoading((l) => ({ ...l, realizados: false })))
    aulavera.listEvents('workshop')
      .then((rows) => setFuturos(rows ?? []))
      .catch((err) => showToast(`Error al cargar futuros: ${err.message}`))
      .finally(() => setLoading((l) => ({ ...l, futuros: false })))
    aulavera.listDisciplines()
      .then((rows) => setDisciplines(rows ?? []))
      .catch((err) => showToast(`Error al cargar disciplinas: ${err.message}`))
      .finally(() => setLoading((l) => ({ ...l, disciplines: false })))
  }, [showToast])

  return (
    <>
      <header className="page-header">
        <span className="eyebrow">Proyectos &amp; actividades</span>
        <h1>Lo que <em>hicimos</em>, lo que está por <em>llegar</em>.</h1>
        <p className="page-lead">
          Construcciones, terapias, encuentros y talleres — todo lo que va dando forma
          a la granja-escuela.
        </p>
      </header>

      <section className="section section-narrow">
        <nav className="tabs" role="tablist">
          <button className={`tab-btn ${tab === 'realizados' ? 'is-active' : ''}`} onClick={() => setTab('realizados')}>
            Realizados <span className="count">{realizados.length}</span>
          </button>
          <button className={`tab-btn ${tab === 'futuros' ? 'is-active' : ''}`} onClick={() => setTab('futuros')}>
            Futuros <span className="count">{futuros.length}</span>
          </button>
          <button className={`tab-btn ${tab === 'areas-accion' ? 'is-active' : ''}`} onClick={() => setTab('areas-accion')}>
            Áreas de acción <span className="count">{disciplines.length}</span>
          </button>
        </nav>

        <div>
          {tab === 'realizados' && <Realizados events={realizados} loading={loading.realizados} />}
          {tab === 'futuros' && <Futuros events={futuros} loading={loading.futuros} onReserve={setReserveItem} />}
          {tab === 'areas-accion' && <AreasAccion disciplines={disciplines} loading={loading.disciplines} />}
        </div>
      </section>

      <Poem text={elAlquimista} author="El Alquimista" source="Paulo Coelho, 1987" />

      <ReserveModal item={reserveItem} onClose={() => setReserveItem(null)} />
    </>
  )
}
