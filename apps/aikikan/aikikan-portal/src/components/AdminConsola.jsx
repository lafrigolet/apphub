// Shell de administración minimalista para owner/admin del tenant.
// Recibe el JWT desde localStorage (clave `aikikan_access_token`) y, si no
// hay sesión válida o el rol no es owner/admin, redirige a `/`.
//
// V1 expone una sola sección: "Subscripción". Se irán añadiendo más
// módulos a medida que el panel crezca.

import { useEffect, useState } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import * as auth from '../lib/auth.js'
import AdminSubscription from './AdminSubscription.jsx'

function decodeJwt(token) {
  try {
    const [, payload] = token.split('.')
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')))
  } catch {
    return null
  }
}

function readIdentity() {
  const token = auth.getAccessToken()
  if (!token) return null
  const claims = decodeJwt(token)
  if (!claims) return null
  return {
    token,
    userId:    claims.sub,
    appId:     claims.app_id,
    tenantId:  claims.tenant_id,
    role:      claims.role,
    email:     claims.email,
  }
}

export default function AdminConsola() {
  const [section, setSection] = useState('subscription')
  const identity = readIdentity()
  const navigate = useNavigate()

  if (!identity)                                                    return <Navigate to="/" replace />
  if (!['owner', 'admin'].includes(identity.role))                  return <Navigate to="/" replace />

  function logout() {
    auth.clearSession()
    navigate('/', { replace: true })
  }

  return (
    <div className="admin-consola">
      <header className="admin-header">
        <div className="admin-header-logo">AIKI<span>KAN</span> · CONSOLA</div>
        <div className="admin-header-right">
          <span className="admin-header-user">{identity.email} · {identity.role}</span>
          <button className="admin-header-logout" onClick={logout}>Cerrar sesión</button>
        </div>
      </header>

      <div className="admin-layout">
        <aside className="admin-sidebar">
          <nav>
            <button
              className={`admin-sidebar-item ${section === 'subscription' ? 'active' : ''}`}
              onClick={() => setSection('subscription')}
            >
              Subscripción
            </button>
          </nav>
        </aside>

        <main className="admin-main">
          {section === 'subscription' && <AdminSubscription identity={identity} />}
        </main>
      </div>
    </div>
  )
}
