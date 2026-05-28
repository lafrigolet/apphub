import { Link, Outlet, useNavigate } from 'react-router-dom'
import { clearSession, getIdentity } from '../../lib/auth.js'

export default function AdminShell() {
  const identity = getIdentity()
  const navigate = useNavigate()

  function onLogout() {
    clearSession()
    navigate('/admin/login', { replace: true })
  }

  return (
    <div className="min-h-screen bg-bone text-ink-900">
      <header className="border-b border-ink-900/5 bg-white">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 h-14 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link to="/admin/inquiries" className="flex items-center gap-2.5">
              <span className="relative inline-flex items-center justify-center w-8 h-8 rounded-lg bg-electric-500 text-white">
                <span className="font-display font-bold text-xs tracking-tight">JS</span>
              </span>
              <span className="font-display font-semibold tracking-tight">JS Electric<span className="text-electric-500">.</span><span className="text-ink-700/60 font-normal ml-2">admin</span></span>
            </Link>
            <nav className="hidden sm:flex items-center gap-5 text-sm">
              <Link to="/admin/inquiries"   className="text-ink-800 hover:text-electric-700 transition">Leads</Link>
              <Link to="/admin/calculadora" className="text-ink-800 hover:text-electric-700 transition">Calculadora</Link>
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <span className="hidden sm:block text-xs text-ink-700">
              {identity?.email} · <span className="font-mono text-ink-700/70">{identity?.role}</span>
            </span>
            <button onClick={onLogout}
              className="text-sm font-medium text-ink-800 hover:text-red-700 transition">
              Salir
            </button>
          </div>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-5 sm:px-8 py-10">
        <Outlet />
      </main>
    </div>
  )
}
