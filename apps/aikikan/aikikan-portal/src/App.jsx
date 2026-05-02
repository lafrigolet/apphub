import { useState } from 'react'
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
import AdminShell from './components/AdminShell.jsx'
import { getIdentity, clearSession, isAdminRole } from './lib/auth.js'

export default function App() {
  useScrollReveal()
  const [loginOpen, setLoginOpen] = useState(false)
  const [identity, setIdentity] = useState(() => getIdentity())

  function handleLoggedIn() {
    setIdentity(getIdentity())
  }

  function handleLogout() {
    clearSession()
    setIdentity(null)
  }

  // Admin autenticado → la consola de admin se monta INLINE en este SPA
  // (vía @apphub/tenant-console-ui). No salimos de aikikan.apphub.local.
  // Cuando el shell hace logout (apphub:unauthorized), volvemos a la
  // landing — el AdminShell wrapper escucha ese evento y llama onExit.
  if (identity && isAdminRole(identity.role)) {
    return <AdminShell onExit={handleLogout} />
  }

  // Socio autenticado → área privada del portal aikikan.
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
      <Dojos />
      <Contact />
      <Footer />
      {loginOpen && <Login onClose={() => setLoginOpen(false)} onLoggedIn={handleLoggedIn} />}
    </>
  )
}
