// Inline mount of @apphub/tenant-console-ui for the admin flow.
//
// In the previous design the admin login redirected to
// tenant-console.hulkstein.local with a token in the URL fragment. Now we
// keep the admin inside aikikan-portal: same SPA, same subdomain, the
// shell is just rendered as another React tree.
//
// `tokenKey` aligns the shell's localStorage with aikikan-portal's
// existing key (aikikan_access_token), so configurable that the package
// reads/writes the same JWT as the rest of the portal — no token
// duplication, single source of truth.
//
// `detectHostTenant={false}` because the host's subdomain (aikikan) is
// NOT a tenant subdomain; without this flag the shell would query
// /api/tenants/by-subdomain/aikikan and incorrectly treat it as a host
// mismatch.
import { useEffect } from 'react'
import { AdminShell as TenantAdminShell, configureAuth } from '@apphub/tenant-console-ui'

const TOKEN_KEY = 'aikikan_access_token'

// Configure ONCE at module load — before any AdminShell render — so the
// shell's auth.js singleton uses the right key from its first read.
configureAuth({ tokenKey: TOKEN_KEY })

export default function AdminShell({ onExit }) {
  // When the shell logs out (the user clicks "Cerrar sesión" inside the
  // embedded shell), the apphub:unauthorized event fires and the host
  // SPA should drop back to the landing. We listen at this layer so the
  // host App.jsx doesn't need to know how the shell does logout.
  useEffect(() => {
    if (!onExit) return
    const handler = () => onExit()
    window.addEventListener('apphub:unauthorized', handler)
    return () => window.removeEventListener('apphub:unauthorized', handler)
  }, [onExit])

  // El Nav fixed de la landing ocupa ~76px arriba. El shell embebido:
  //   - suprime su Topbar interno (no duplicar barra superior),
  //   - su Sidebar usa top:76 sticky,
  //   - el wrapper exterior reserva 76px de padding-top para no
  //     quedar tapado por el Nav.
  return (
    <div style={{ paddingTop: 76 }}>
      <TenantAdminShell detectHostTenant={false} embedded={true} />
    </div>
  )
}
