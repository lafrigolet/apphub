import { useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Landing from './views/Landing.jsx'
import AdminConsole from './components/admin/AdminShell.jsx'
import EventosAdmin from './components/admin/EventosAdmin.jsx'
import CalendarioAdmin from './components/admin/CalendarioAdmin.jsx'
import ProductosAdmin from './components/admin/ProductosAdmin.jsx'
import Login from './components/admin/Login.jsx'
import { getIdentity, isAdmin, logout } from './lib/auth.js'

// /admin → área del owner. Sin sesión (o rol insuficiente) muestra el login;
// con sesión válida: /admin = consola reutilizada (@apphub/tenant-console-ui),
// /admin/eventos = gestión de próximos eventos.
function AdminRoute() {
  const [identity, setIdentity] = useState(() => getIdentity())
  if (!identity || !isAdmin(identity.role)) return <Login onLogged={setIdentity} />
  const onExit = () => { logout(); setIdentity(null) }
  return (
    <Routes>
      <Route index element={<AdminConsole onExit={onExit} />} />
      <Route path="calendario" element={<CalendarioAdmin onExit={onExit} />} />
      <Route path="eventos" element={<EventosAdmin onExit={onExit} />} />
      <Route path="productos" element={<ProductosAdmin onExit={onExit} />} />
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
