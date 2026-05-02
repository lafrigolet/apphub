import { useEffect, useState } from 'react'
import useScrollReveal from './hooks/useScrollReveal.js'
import Cursor from './components/Cursor.jsx'
import Nav from './components/Nav.jsx'
import Hero from './components/Hero.jsx'
import PullQuote from './components/PullQuote.jsx'
import Masters from './components/Masters.jsx'
import Videos from './components/Videos.jsx'
import About from './components/About.jsx'
import Dojos from './components/Dojos.jsx'
import Events from './components/Events.jsx'
import Recognition from './components/Recognition.jsx'
import Contact from './components/Contact.jsx'
import Footer from './components/Footer.jsx'
import Login from './components/Login.jsx'
import MemberHome from './components/MemberHome.jsx'
import { getIdentity, clearSession, isAdminRole, tenantConsoleUrl, getAccessToken } from './lib/auth.js'

export default function App() {
  useScrollReveal()
  const [loginOpen, setLoginOpen] = useState(false)
  const [identity, setIdentity] = useState(() => getIdentity())

  // Si hay un identity persistente con rol admin (caso: el usuario refresca
  // estando en aikikan después de loguearse como admin), lo redirigimos a
  // la tenant-console. Mantener el portal aikikan abierto en ese estado
  // sería un bug — el rol de admin no tiene UI propia aquí.
  useEffect(() => {
    if (identity && isAdminRole(identity.role)) {
      const token = getAccessToken()
      if (token) window.location.href = tenantConsoleUrl(token)
    }
  }, [identity])

  function handleLoggedIn() {
    setIdentity(getIdentity())
  }

  function handleLogout() {
    clearSession()
    setIdentity(null)
  }

  // Socio autenticado → área privada. Admin nunca llega aquí (el efecto de
  // arriba lo redirige, y el dispatch del Login también).
  if (identity && !isAdminRole(identity.role)) {
    return <MemberHome identity={identity} onLogout={handleLogout} />
  }

  return (
    <>
      <Cursor />
      <Nav onLoginOpen={() => setLoginOpen(true)} />
      <Hero />
      <PullQuote />
      <Recognition />
      <About />
      <Masters />
      <Videos />
      <Contact />
      <Dojos />
      <Footer />
      {loginOpen && <Login onClose={() => setLoginOpen(false)} onLoggedIn={handleLoggedIn} />}
    </>
  )
}
