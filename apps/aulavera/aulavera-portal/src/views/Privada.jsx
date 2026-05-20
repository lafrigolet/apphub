import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useToast } from '../components/Toast'
import { aulavera } from '../lib/api'

function PrivateLogin({ onLogin }) {
  const [email, setEmail] = useState('socio@aulavera.org')
  const [password, setPassword] = useState('demo')
  const showToast = useToast()

  // V1 — login client-side (sin platform/auth todavía). En V2 reemplazar
  // por POST /api/auth/login y guardar el JWT en localStorage('token').
  const onSubmit = (e) => {
    e.preventDefault()
    onLogin({ name: 'Daniel', email })
    showToast('Bienvenido/a 🌿')
  }

  return (
    <>
      <header className="page-header" style={{ paddingBottom: 0 }}>
        <span className="eyebrow">Área privada</span>
        <h1>Para <em>socios</em><br />y colaboradores.</h1>
        <p className="page-lead">
          Vídeos, recursos pedagógicos y documentación interna — un espacio reservado a quienes
          están vinculados con la Fundación.
        </p>
      </header>

      <section className="section section-narrow">
        <div className="login-wrap">
          <div className="login-card">
            <h2>Acceder</h2>
            <p className="sub">Identifícate con tu correo y contraseña</p>
            <form className="form" onSubmit={onSubmit}>
              <div className="field">
                <label htmlFor="lem">Email</label>
                <input id="lem" type="email" placeholder="tu@correo.com" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="lpw">Contraseña</label>
                <input id="lpw" type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              <button type="submit" className="btn btn-primary">Entrar →</button>
            </form>
            <div className="login-meta">
              ¿Aún no eres socio/a? <Link to="/donar">Únete al proyecto</Link>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}

function ResourceRow({ icon, item, action, onClick }) {
  return (
    <a className="resource-row" onClick={(e) => { e.preventDefault(); onClick?.() }}>
      <div className="ic">{icon}</div>
      <div>
        <div className="ttl">{item.title}</div>
        <div className="sub">{item.subtitle}</div>
      </div>
      <div className="act">{action}</div>
    </a>
  )
}

function PrivateDashboard({ session, onLogout }) {
  const [tab, setTab] = useState('videos')
  const [videos, setVideos] = useState([])
  const [guides, setGuides] = useState([])
  const [docs, setDocs] = useState([])
  const showToast = useToast()

  useEffect(() => {
    aulavera.listResources('video').then((r) => setVideos(r ?? [])).catch((e) => showToast(e.message))
    aulavera.listResources('guide').then((r) => setGuides(r ?? [])).catch((e) => showToast(e.message))
    aulavera.listResources('document').then((r) => setDocs(r ?? [])).catch((e) => showToast(e.message))
  }, [showToast])

  return (
    <>
      <header className="page-header">
        <span className="eyebrow">Área privada · {session.email}</span>
        <h1>Bienvenida, <em>{session.name}</em>.</h1>
        <p className="page-lead">Aquí encontrarás los recursos reservados a la comunidad de socios y colaboradores.</p>
      </header>

      <section className="section section-narrow">
        <div className="private-grid">
          <aside className="private-side">
            <div className="user">
              <div className="av">{session.name[0]}</div>
              <div>
                <div className="nm">{session.name}</div>
                <div className="rl">Socio/a · desde 2025</div>
              </div>
            </div>
            <nav className="private-nav">
              <button className={tab === 'videos' ? 'is-active' : ''} onClick={() => setTab('videos')}>🎬 Vídeos grabados</button>
              <button className={tab === 'recursos' ? 'is-active' : ''} onClick={() => setTab('recursos')}>📚 Recursos para socios</button>
              <button className={tab === 'docs' ? 'is-active' : ''} onClick={() => setTab('docs')}>📄 Documentación</button>
              <button className={tab === 'cuota' ? 'is-active' : ''} onClick={() => setTab('cuota')}>💛 Mi cuota</button>
              <button onClick={onLogout} style={{ marginTop: 12, color: 'var(--terra)' }}>↩ Salir</button>
            </nav>
          </aside>
          <div>
            {tab === 'videos' && (
              <>
                <div style={{ background: 'var(--paper)', border: '1px solid var(--line)', borderLeft: '4px solid var(--ochre)', padding: '18px 22px', borderRadius: 4, marginBottom: 24, fontSize: '0.95rem', color: 'var(--ink-soft)', fontStyle: 'italic' }}>
                  Cada vídeo se publica con la correspondiente autorización de las personas grabadas. El material puede descargarse y utilizarse por terceros bajo esa misma condición.
                </div>
                <div className="resource-list">
                  {videos.map((v) => (
                    <ResourceRow key={v.id} icon="▶" item={v} action="Ver →" onClick={() => showToast('Cargando reproductor...')} />
                  ))}
                </div>
              </>
            )}
            {tab === 'recursos' && (
              <div className="resource-list">
                {guides.map((r) => (
                  <ResourceRow key={r.id} icon="⤓" item={r} action="Descargar →" onClick={() => showToast('Descargando...')} />
                ))}
              </div>
            )}
            {tab === 'docs' && (
              <div className="resource-list">
                {docs.map((d) => (
                  <ResourceRow key={d.id} icon="📄" item={d} action="Abrir →" onClick={() => showToast('Abriendo...')} />
                ))}
              </div>
            )}
            {tab === 'cuota' && (
              <div style={{ background: 'var(--cream)', border: '1px solid var(--line)', borderRadius: 6, padding: 32 }}>
                <h3 style={{ marginBottom: 18 }}>Tu cuota mensual</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 28 }}>
                  <div>
                    <div className="eyebrow" style={{ fontStyle: 'normal', fontFamily: 'var(--script)', color: 'var(--terra)', fontSize: '1.2rem' }}>Cuota actual</div>
                    <div style={{ fontFamily: 'var(--display)', fontSize: '2.4rem', color: 'var(--forest-deep)' }}>10 € <small style={{ fontSize: '1rem', fontStyle: 'italic', color: 'var(--ink-mute)' }}>/mes</small></div>
                  </div>
                  <div>
                    <div className="eyebrow" style={{ fontStyle: 'normal', fontFamily: 'var(--script)', color: 'var(--terra)', fontSize: '1.2rem' }}>Total donado</div>
                    <div style={{ fontFamily: 'var(--display)', fontSize: '2.4rem', color: 'var(--forest-deep)' }}>120 € <small style={{ fontSize: '1rem', fontStyle: 'italic', color: 'var(--ink-mute)' }}>en 2025</small></div>
                  </div>
                </div>
                <p style={{ color: 'var(--ink-soft)', fontStyle: 'italic', marginBottom: 24 }}>
                  Puedes modificar el importe o cancelar tu suscripción en cualquier momento.
                  Te enviaremos el certificado fiscal anual a tu correo.
                </p>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <button className="btn btn-ghost" onClick={() => showToast('Editando cuota...')}>Modificar cuota</button>
                  <button className="btn btn-ghost" onClick={() => showToast('Descargando certificado...')}>Certificado fiscal</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </>
  )
}

export default function Privada() {
  const [session, setSession] = useState(null)

  if (!session) return <PrivateLogin onLogin={setSession} />
  return <PrivateDashboard session={session} onLogout={() => setSession(null)} />
}
