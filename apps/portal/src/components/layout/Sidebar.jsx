import { NavLink } from 'react-router-dom'
import { MOCK_DISPUTES } from '../../data/mock'

const navItem = ({ isActive }) =>
  `nav-item w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm ${isActive ? 'active' : 'text-slate'}`

export default function Sidebar() {
  return (
    <aside className="bg-white border-r border-mist-2 flex flex-col py-6 px-3" style={{ width: 240, flexShrink: 0 }}>
      {/* Logo */}
      <div className="px-3 mb-8">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-stripe flex items-center justify-center">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>
          <span className="font-semibold text-[15px] text-ink">SplitPay</span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 flex flex-col gap-1">
        <p className="px-3 text-[10px] font-semibold text-slate uppercase tracking-wider mb-1">Principal</p>

        <NavLink to="/dashboard" className={navItem}>
          <svg className="nav-icon w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
            <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
          Dashboard
        </NavLink>

        <NavLink to="/transactions" className={navItem}>
          <svg className="nav-icon w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
            <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
          </svg>
          Transacciones
        </NavLink>

        <NavLink to="/payouts" className={navItem}>
          <svg className="nav-icon w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
            <path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
          </svg>
          Liquidaciones
        </NavLink>

        <NavLink to="/disputes" className={navItem}>
          <svg className="nav-icon w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
            <path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
          Disputas
          {MOCK_DISPUTES.length > 0 && (
            <span className="ml-auto badge badge-red py-0.5 px-2 text-[10px]">{MOCK_DISPUTES.length}</span>
          )}
        </NavLink>

        <p className="px-3 text-[10px] font-semibold text-slate uppercase tracking-wider mb-1 mt-4">Configuración</p>

        <NavLink to="/splits" className={navItem}>
          <svg className="nav-icon w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
            <path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l5.1 5.1M4 4l5 5" />
          </svg>
          Reglas de Split
        </NavLink>

        <NavLink to="/merchants" className={navItem}>
          <svg className="nav-icon w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
            <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
          </svg>
          Merchants
        </NavLink>

        <NavLink to="/checkout" className={navItem}>
          <svg className="nav-icon w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
            <rect x="1" y="4" width="22" height="16" rx="2" /><path d="M1 10h22" />
          </svg>
          Checkout Demo
        </NavLink>

        <NavLink to="/onboarding" className={navItem}>
          <svg className="nav-icon w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
            <path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" />
            <path d="M19 8v6M22 11h-6" />
          </svg>
          Onboarding KYC
        </NavLink>
      </nav>

      {/* User */}
      <div className="mt-4 px-3">
        <div className="divider mb-4" />
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-stripe-light flex items-center justify-center text-xs font-semibold text-stripe">MR</div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-ink truncate">Marta Rodríguez</p>
            <p className="text-[10px] text-slate">Admin · Plataforma</p>
          </div>
          <button className="text-slate hover:text-ink" title="Ajustes">
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
            </svg>
          </button>
        </div>
      </div>
    </aside>
  )
}
