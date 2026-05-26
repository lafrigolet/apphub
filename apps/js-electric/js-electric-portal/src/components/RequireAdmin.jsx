import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { getIdentity, isAdminRole } from '../lib/auth.js'

// Guard síncrono — lee el token de localStorage y bloquea si no es admin.
// No hace HTTP: la verificación real de firma/expiración la hace el
// backend en cada llamada (decodeToken solo lee exp del payload).
export default function RequireAdmin() {
  const location = useLocation()
  const identity = getIdentity()
  if (!identity || !isAdminRole(identity.role)) {
    return <Navigate to="/admin/login" replace state={{ from: location }} />
  }
  return <Outlet />
}
