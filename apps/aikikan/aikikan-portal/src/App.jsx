import { useEffect, useState } from 'react'
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
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
import ConsoleLayout from './components/admin/ConsoleLayout.jsx'
import UsersAdmin from './components/admin/UsersAdmin.jsx'
import BillingAdmin from './components/admin/BillingAdmin.jsx'
import ActivateView from './components/ActivateView.jsx'
import ResetPasswordView from './components/ResetPasswordView.jsx'
import MagicLoginView from './components/MagicLoginView.jsx'
import { getIdentity, clearSession, isAdminRole } from './lib/auth.js'

// Landing pública: la home / con todo el contenido de marketing.
function LandingPage() {
  return (
    <div className="landing">
      <Hero />
      <PullQuote />
      <Recognition />
      <About />
      <Masters />
      <Videos />
      <Events />
      <Dojos />
      <Contact />
      <Footer />
    </div>
  )
}

// Guards: solo admins entran a /consola; solo socios a /area-socio.
function RequireAdmin({ identity, children }) {
  if (!identity || !isAdminRole(identity.role)) return <Navigate to="/" replace />
  return children
}
function RequireMember({ identity, children }) {
  if (!identity || isAdminRole(identity.role))  return <Navigate to="/" replace />
  return children
}

export default function App() {
  useScrollReveal()
  const navigate = useNavigate()
  const location = useLocation()
  const [loginOpen, setLoginOpen] = useState(false)
  const [identity, setIdentity]   = useState(() => getIdentity())

  // react-router v6 NO scrollea automáticamente al hash al cambiar de
  // ruta. Cuando el Nav apunta a /#about y estamos en /consola, hay que
  // hacerlo a mano: esperamos un tick para que la landing termine de
  // montarse y luego scrollIntoView al elemento del id.
  useEffect(() => {
    if (!location.hash) return
    const id = location.hash.slice(1)
    const t = setTimeout(() => {
      const el = document.getElementById(id)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 0)
    return () => clearTimeout(t)
  }, [location.pathname, location.hash])

  function handleLoggedIn() {
    const id = getIdentity()
    setIdentity(id)
    if (id && isAdminRole(id.role)) navigate('/consola')
    else if (id)                     navigate('/area-socio')
  }
  function handleLogout() {
    clearSession()
    setIdentity(null)
    navigate('/')
  }

  // El <Nav> y el <Cursor> envuelven a TODAS las rutas — la cabecera
  // queda visible en /, /consola y /area-socio sin diferencia.
  return (
    <>
      <Cursor />
      <div className="landing">
        <Nav
          onLoginOpen={() => setLoginOpen(true)}
          identity={identity}
          onLogout={handleLogout}
        />
      </div>

      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/activate" element={<ActivateView onLoggedIn={handleLoggedIn} />} />
        <Route path="/reset-password" element={<ResetPasswordView onLoginOpen={() => setLoginOpen(true)} />} />
        <Route path="/magic-login" element={<MagicLoginView onLoggedIn={handleLoggedIn} />} />
        <Route
          path="/consola"
          element={
            <RequireAdmin identity={identity}>
              <AdminShell onExit={handleLogout} />
            </RequireAdmin>
          }
        />
        <Route
          path="/consola/usuarios"
          element={
            <RequireAdmin identity={identity}>
              <ConsoleLayout><UsersAdmin /></ConsoleLayout>
            </RequireAdmin>
          }
        />
        <Route
          path="/consola/billing"
          element={
            <RequireAdmin identity={identity}>
              <ConsoleLayout><BillingAdmin /></ConsoleLayout>
            </RequireAdmin>
          }
        />
        <Route
          path="/area-socio"
          element={
            <RequireMember identity={identity}>
              <MemberHome identity={identity} onLogout={handleLogout} />
            </RequireMember>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      {loginOpen && <Login onClose={() => setLoginOpen(false)} onLoggedIn={handleLoggedIn} />}
    </>
  )
}
