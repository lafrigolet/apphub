// Consola admin embebida: monta @apphub/tenant-console-ui dentro del portal
// (misma SPA, mismo subdominio). El shell expone la gestión de los módulos de
// plataforma (servicios, recursos, reservas, bonos, notificaciones, usuarios)
// usando el JWT que guarda lib/auth.js (clave compartida vía configureAuth).
import { useEffect } from 'react'
import { AdminShell as TenantAdminShell } from '@apphub/tenant-console-ui'
import AdminBar from './AdminBar.jsx'
import '../../lib/auth.js' // ejecuta configureAuth({ tokenKey }) al importar

export default function AdminConsole({ onExit }) {
  useEffect(() => {
    if (!onExit) return
    const handler = () => onExit()
    window.addEventListener('apphub:unauthorized', handler)
    return () => window.removeEventListener('apphub:unauthorized', handler)
  }, [onExit])

  // detectHostTenant=false: el subdominio (luciapassardi) es un app host, no un
  // subdominio de tenant; sin esto el shell intentaría resolver el tenant por
  // host. El tenant sale del JWT.
  return (
    <>
      <AdminBar active="consola" />
      <TenantAdminShell detectHostTenant={false} embedded={true} />
    </>
  )
}
