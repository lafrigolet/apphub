import { useApp } from './lib/context'

export default function Topbar() {
  const { identity, tenant, app, onLogout } = useApp()

  return (
    <header className="h-14 border-b border-line bg-paper flex items-center justify-between px-5 sticky top-0 z-10">
      <div className="flex items-baseline gap-3">
        <span className="font-display text-[18px] tracking-tight">
          {tenant?.display_name ?? app?.display_name ?? 'Tenant Console'}
        </span>
        <span className="text-[11px] uppercase tracking-[0.16em] text-ink3 font-mono">
          {app?.app_id}
        </span>
      </div>
      <div className="flex items-center gap-4 text-[13px] text-ink2">
        <span className="text-ink3">{identity?.email}</span>
        <button onClick={onLogout} className="text-ink3 hover:text-ink">Salir</button>
      </div>
    </header>
  )
}
