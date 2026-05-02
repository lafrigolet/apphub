import { useState } from 'react'
import MemberProfile from './MemberProfile.jsx'

// Área de socio. Hoy: bienvenida + grid de cards. "Mi perfil" abre la
// vista MemberProfile (lectura/edición del propio user). El resto siguen
// como placeholder hasta que se especifiquen.
//
// Importante: este componente solo se renderiza para usuarios autenticados
// con rol no-admin; los admins se redirigen a la tenant-console antes.
export default function MemberHome({ identity, onLogout }) {
  const [view, setView] = useState('home')

  if (view === 'profile') return <MemberProfile onBack={() => setView('home')} />

  // El nombre del kicker viene del JWT (display_name no llega en el token,
  // así que usamos la parte local del email como fallback hasta que el user
  // entre en "Mi perfil"; allí cargamos display_name desde el backend).
  const name = identity?.email?.split('@')[0] ?? 'socio'

  return (
    <main className="member-home">
      <header className="member-home-nav">
        <div className="member-home-logo">AIKIKAN<span> /</span> ÁREA DE SOCIOS</div>
        <button className="member-home-logout" onClick={onLogout}>Cerrar sesión</button>
      </header>

      <section className="member-home-hero">
        <p className="member-home-eyebrow"><span className="slash">/</span> Bienvenido</p>
        <h1 className="member-home-title">
          Hola, <span className="member-home-name">{name}</span>
        </h1>
        <p className="member-home-lead">
          Estás dentro del área privada de la asociación. Pronto encontrarás aquí
          tus cuotas, los eventos a los que estás inscrito, los certificados de
          grado y los materiales de formación.
        </p>
      </section>

      <section className="member-home-grid">
        <article className="member-home-card member-home-card-active" onClick={() => setView('profile')}>
          <h2>Mi perfil</h2>
          <p>Datos de socio, email, rol y fechas de alta y último acceso.</p>
          <span className="member-home-go">Abrir →</span>
        </article>
        <article className="member-home-card">
          <h2>Cuotas</h2>
          <p>Histórico de pagos y próxima renovación.</p>
          <span className="member-home-soon">Próximamente</span>
        </article>
        <article className="member-home-card">
          <h2>Eventos</h2>
          <p>Seminarios y cursos en los que estás inscrito.</p>
          <span className="member-home-soon">Próximamente</span>
        </article>
        <article className="member-home-card">
          <h2>Certificados</h2>
          <p>Descarga de certificados de grado y asistencia.</p>
          <span className="member-home-soon">Próximamente</span>
        </article>
      </section>
    </main>
  )
}
