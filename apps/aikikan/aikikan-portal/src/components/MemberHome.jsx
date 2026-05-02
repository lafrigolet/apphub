// Área de socio. Hoy es la página de bienvenida — placeholder para la
// funcionalidad real (cuotas, eventos inscritos, certificados, etc.) que
// llegará cuando se especifique. Importante: esto se renderiza cuando el
// usuario ya está autenticado con rol no-admin; los admins se redirigen a
// la tenant-console antes de pisar este componente.
export default function MemberHome({ identity, onLogout }) {
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
        <article className="member-home-card">
          <h2>Mi perfil</h2>
          <p>Datos de socio, fechas de alta y graduaciones.</p>
          <span className="member-home-soon">Próximamente</span>
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
