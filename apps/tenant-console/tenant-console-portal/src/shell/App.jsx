import { AppProvider, useApp } from './lib/context'
import LoginView from './LoginView'
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

function Shell() {
  const { identity, onLogin } = useApp()
  if (!identity) return <LoginView onSuccess={onLogin} />
  return (
    <div className="min-h-screen flex flex-col">
      <Topbar />
      <div className="flex-1 flex">
        <Sidebar />
        <main className="flex-1 min-w-0">
          <MainContent />
        </main>
      </div>
      <ModalContainer />
      <Toasts />
    </div>
  )
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  )
}
