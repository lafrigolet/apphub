import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Landing from './views/Landing.jsx'
import EventosAdmin from './components/admin/EventosAdmin.jsx'
import CalendarioAdmin from './components/admin/CalendarioAdmin.jsx'
import ProductosAdmin from './components/admin/ProductosAdmin.jsx'
import PedidosAdmin from './components/admin/PedidosAdmin.jsx'
import SuscripcionAdmin from './components/admin/SuscripcionAdmin.jsx'
import UsersAdmin from './components/admin/UsersAdmin.jsx'
import ConsultasAdmin from './components/admin/ConsultasAdmin.jsx'
import { getIdentity, isAdmin, logout, ensureSession, refreshSession } from './lib/auth.js'

// /admin → área del owner. Sin sesión (o rol insuficiente) redirige a la landing
// con ?acceder=1 para usar el único punto de acceso ("Acceder"); con sesión
// válida: /admin = consola reutilizada (@apphub/tenant-console-ui) + secciones.
function AdminRoute() {
  const [identity, setIdentity] = useState(() => getIdentity())
  const [booting, setBooting] = useState(() => !getIdentity())

  // Al montar sin sesión válida (p.ej. recarga tras caducar el access token de
  // 15 min), intenta renovar con el refresh token antes de mostrar el login.
  useEffect(() => {
    let alive = true
    if (!identity) {
      ensureSession().then((id) => { if (alive) { setIdentity(id); setBooting(false) } })
    }
    return () => { alive = false }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Mientras hay sesión, refresca el access token de forma proactiva cada 10 min
  // (vida del access = 15 min) para que no caduque en plena sesión.
  useEffect(() => {
    if (!identity) return undefined
    const t = setInterval(() => { refreshSession().then((tok) => { if (tok) setIdentity(getIdentity()) }) }, 10 * 60 * 1000)
    return () => clearInterval(t)
  }, [identity])

  // Si el refresh falla de verdad (refresh token caducado/revocado), la consola
  // embebida emite este evento → caemos al login.
  useEffect(() => {
    const onUnauth = () => { logout(); setIdentity(null); setBooting(false) }
    window.addEventListener('apphub:unauthorized', onUnauth)
    return () => window.removeEventListener('apphub:unauthorized', onUnauth)
  }, [])

  if (booting) {
    return <div className="min-h-screen bg-piedra flex items-center justify-center text-tinta/50">Cargando…</div>
  }
  // Sin sesión o sin rol admin → al único punto de acceso ("Acceder" de la landing).
  if (!identity || !isAdmin(identity.role)) return <Navigate to="/?acceder=1" replace />
  const onExit = () => { logout(); setIdentity(null) }
  return (
    <Routes>
      <Route index element={<Navigate to="/admin/calendario" replace />} />
      <Route path="calendario" element={<CalendarioAdmin onExit={onExit} />} />
      <Route path="eventos" element={<EventosAdmin onExit={onExit} />} />
      <Route path="productos" element={<ProductosAdmin onExit={onExit} />} />
      <Route path="pedidos" element={<PedidosAdmin onExit={onExit} />} />
      <Route path="suscripcion" element={<SuscripcionAdmin onExit={onExit} />} />
      <Route path="usuarios" element={<UsersAdmin onExit={onExit} />} />
      <Route path="consultas" element={<ConsultasAdmin onExit={onExit} />} />
      <Route path="*" element={<Navigate to="/admin" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/admin/*" element={<AdminRoute />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
