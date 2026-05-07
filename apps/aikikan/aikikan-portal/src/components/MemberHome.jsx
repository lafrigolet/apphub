import { useEffect, useState } from 'react'
import MemberProfile from './MemberProfile.jsx'
import MemberFees    from './MemberFees.jsx'

// Área de socio. Bienvenida + grid de cards. Cada card abre una vista
// dedicada con sus propios datos. La detección del query string
// `fees_status` permite mostrar un mensaje breve cuando Stripe redirige
// de vuelta tras un checkout (?fees_status=success|cancel).
export default function MemberHome({ identity, onLogout }) {
  const [view, setView] = useState('home')
  const [feesNotice, setFeesNotice] = useState(null)

  // Cuando Stripe nos devuelve a /area-socio?fees_status=success
  // aterrizamos directos en la vista de cuotas para que el socio vea
  // el cambio reflejado.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const status = params.get('fees_status')
    if (status === 'success') {
      setFeesNotice({ kind: 'success', text: 'Pago completado. Gracias por tu cuota.' })
      setView('fees')
    } else if (status === 'cancel') {
      setFeesNotice({ kind: 'warn', text: 'Pago cancelado. Puedes intentarlo de nuevo cuando quieras.' })
      setView('fees')
    }
    if (status) {
      // Limpiar el query string del URL bar.
      window.history.replaceState(null, '', window.location.pathname)
    }
  }, [])

  if (view === 'profile') return <MemberProfile onBack={() => setView('home')} />
  if (view === 'fees')    return (
    <>
      {feesNotice && (
        <div className={`fee-toast fee-toast-${feesNotice.kind}`} onClick={() => setFeesNotice(null)}>
          {feesNotice.text}
        </div>
      )}
      <MemberFees onBack={() => { setView('home'); setFeesNotice(null) }} />
    </>
  )

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
        <article className="member-home-card member-home-card-active" onClick={() => setView('fees')}>
          <h2>Cuotas</h2>
          <p>Matrícula, seguro, suscripción anual y histórico de pagos.</p>
          <span className="member-home-go">Abrir →</span>
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
