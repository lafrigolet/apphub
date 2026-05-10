import { AppProvider, useApp } from './lib/context'
import LoginView from './LoginView'
import ActivateView from './ActivateView'
import Topbar from './Topbar'
import Sidebar from './Sidebar'
import DashboardGrid from './DashboardGrid'

function MainContent() {
  const { view, routes, booting, bootError } = useApp()
  if (booting)   return <div className="p-10 text-center text-ink3">Cargando…</div>
  if (bootError) return <div className="p-10 text-center text-danger">Error al inicializar: {bootError}</div>
  if (view === 'home') return <DashboardGrid />
  const factory = routes[view]
  if (!factory) return <div className="p-10 text-ink3">Vista no encontrada.</div>
  // Routes can be sync (factory returns JSX) or async (factory returns a
  // promise of JSX) — DashboardGrid keeps both shapes alive.
  const r = factory()
  return r
}

function ModalContainer() {
  const { modal, closeModal } = useApp()
  if (!modal) return null
  const sizeClass = modal.size === 'lg' ? 'max-w-2xl' : modal.size === 'sm' ? 'max-w-sm' : 'max-w-lg'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30" onClick={closeModal}>
      <div className={`w-full ${sizeClass} bg-white rounded-2xl shadow-pop overflow-hidden`} onClick={(e) => e.stopPropagation()}>
        {modal.content}
      </div>
    </div>
  )
}

function Toasts() {
  const { toasts } = useApp()
  if (!toasts.length) return null
  return (
    <div className="fixed bottom-4 right-4 z-50 space-y-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`px-4 py-2 rounded-md shadow-pop text-[13px] border ${
            t.variant === 'danger' ? 'bg-dangerbg border-danger/30 text-danger'
            : t.variant === 'warn' ? 'bg-warnbg   border-warn/30   text-warn'
            : 'bg-okbg border-ok/30 text-ok'
          }`}
        >
          {t.msg}
        </div>
      ))}
    </div>
  )
}

// Banner shown when the user logged in but their JWT's tenant_id differs
// from the tenant bound to the current subdomain. This catches the
// "logged in at acme.apphub.local but the JWT is for bastardo" case
// without forcing a hard redirect — the user keeps a one-click escape.
function HostMismatchBanner() {
  const { hostTenant, tenant, onLogout } = useApp()
  if (!hostTenant?.subdomain || !tenant?.subdomain) return null
  if (hostTenant.tenantId === tenant.id) return null
  const target = `${window.location.protocol}//${tenant.subdomain}.${window.location.hostname.split('.').slice(1).join('.')}${window.location.port ? ':' + window.location.port : ''}/`
  return (
    <div className="bg-warnbg border-b border-warn/30 px-4 py-2 text-[12.5px] text-warn flex items-center justify-between">
      <div>
        Estás en <span className="font-mono">{hostTenant.subdomain}</span> pero tu sesión es del tenant
        <span className="font-medium"> {tenant.display_name}</span>.
      </div>
      <div className="flex items-center gap-3">
        <a href={target} className="underline">Ir a {tenant.subdomain}.*</a>
        <button onClick={onLogout} className="underline">Cerrar sesión</button>
      </div>
    </div>
  )
}

function Shell({ embedded = false }) {
  const { identity, onLogin } = useApp()
  // Magic-link landing — la URL es /activate?token=... y el shell debe
  // mostrar el formulario de activación antes que el login. Detectamos
  // la pathname directamente para no introducir react-router en el
  // paquete (que puede chocar con el router del host).
  if (typeof window !== 'undefined' && window.location.pathname === '/activate') {
    return <ActivateView />
  }
  if (!identity) return <LoginView onSuccess={onLogin} />
  return (
    <div className="min-h-screen flex flex-col">
      {!embedded && <HostMismatchBanner />}
      {!embedded && <Topbar />}
      <div className="flex-1 flex">
        <Sidebar embedded={embedded} />
        <main className="flex-1 min-w-0">
          <MainContent />
        </main>
      </div>
      <ModalContainer />
      <Toasts />
    </div>
  )
}

// Public shell entry. Hosts pass:
//   - `detectHostTenant={false}` when embedding inside another portal
//     whose subdomain is NOT a tenant subdomain.
//   - `embedded={true}` to suppress the shell's own Topbar and the
//     mismatch banner; the host's nav takes over the top of the page
//     and the sidebar starts below it (76px offset).
export default function App({ detectHostTenant = true, embedded = false } = {}) {
  return (
    <AppProvider detectHostTenant={detectHostTenant}>
      <Shell embedded={embedded} />
    </AppProvider>
  )
}
