import { icons } from './icons'
import { initials } from './utils'

export function StatusBadge({ status }) {
  const map = {
    ACTIVE:    { cls: 'text-ok bg-okbg',        dot: '#2F6F4F', label: 'Activo' },
    SUSPENDED: { cls: 'text-warn bg-warnbg',     dot: '#8A6B0A', label: 'Suspendido' },
    ARCHIVED:  { cls: 'text-ink3 bg-paper2',     dot: '#6F6D78', label: 'Archivado' },
    PURGED:    { cls: 'text-danger bg-dangerbg', dot: '#8A2C2C', label: 'Purgado' },
  }
  const s = map[status] || map.ARCHIVED
  return <span className={`badge ${s.cls}`}><span className="dot" style={{ background: s.dot }} />{s.label}</span>
}

export function StripeBadge({ status }) {
  const map = {
    VERIFIED:     { cls: 'text-ok bg-okbg',     label: 'KYC verificado' },
    PENDING:      { cls: 'text-info bg-infobg', label: 'KYC pendiente' },
    RESTRICTED:   { cls: 'text-warn bg-warnbg', label: 'Restringido' },
    DISCONNECTED: { cls: 'text-ink3 bg-paper2', label: 'Desvinculado' },
  }
  const m = map[status] || map.DISCONNECTED
  return <span className={`badge ${m.cls}`}>{m.label}</span>
}

export function PlanBadge({ plan }) {
  const m = {
    STARTER:    'bg-paper2 text-ink2 border border-line',
    PRO:        'bg-infobg text-info',
    ENTERPRISE: 'bg-[#EEE3DC] text-accent2',
  }
  return <span className={`badge ${m[plan] || m.STARTER}`}>{plan}</span>
}

export function RoleBadge({ role }) {
  if (role === 'OWNER')       return <span className="badge bg-[#EEE3DC] text-accent2">Owner</span>
  if (role === 'ADMIN')       return <span className="badge bg-infobg text-info">Admin</span>
  if (role === 'SUPER_ADMIN') return <span className="badge bg-[#EEE3DC] text-accent2">Super Admin</span>
  if (role === 'STAFF')       return <span className="badge bg-infobg text-info">Staff</span>
  return <span className="badge bg-paper2 text-ink3">{role}</span>
}

export function TwoFABadge({ enabled }) {
  return enabled
    ? <span className="badge bg-okbg text-ok">{icons.lock}<span>2FA</span></span>
    : <span className="badge bg-warnbg text-warn">{icons.lock}<span>Sin 2FA</span></span>
}

export function Avatar({ name, color = '#D9D2C2', size }) {
  const style = {
    background: `${color}20`,
    color,
    border: `1px solid ${color}30`,
    ...(size ? { width: size, height: size, fontSize: parseInt(size) * 0.32 + 'px' } : {}),
  }
  return <span className="avatar" style={style}>{initials(name)}</span>
}

export function Kpi({ label, value, hint, tone = 'ink' }) {
  const valColor = tone === 'ok' ? 'text-ok' : 'text-ink'
  return (
    <div className="bg-white border border-line rounded-xl p-5 shadow-card">
      <div className="text-[11px] uppercase tracking-[0.14em] text-ink3 mb-2">{label}</div>
      <div className={`font-display text-[30px] tracking-tight ${valColor}`}>{value}</div>
      <div className="text-[11.5px] text-ink3 mt-1">{hint}</div>
    </div>
  )
}

export function DlRow({ label, children }) {
  return (
    <div className="grid grid-cols-3 px-5 py-3 gap-4">
      <dt className="text-[12.5px] text-ink3">{label}</dt>
      <dd className="col-span-2 text-[13.5px]">{children}</dd>
    </div>
  )
}

export function MiniMetric({ label, value, hint }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.14em] text-ink3">{label}</div>
      <div className="font-display text-[24px] mt-1">{value}</div>
      <div className="text-[11.5px] text-ink3">{hint}</div>
    </div>
  )
}

export function Checklist({ label, done }) {
  return (
    <div className="px-5 py-3 flex items-center gap-3">
      <span className={`w-5 h-5 rounded-full flex items-center justify-center ${done ? 'bg-ok/10 text-ok' : 'bg-paper2 text-ink3 border border-line'}`}>
        {done ? icons.check : null}
      </span>
      <span className={`text-[13.5px] ${done ? '' : 'text-ink3'}`}>{label}</span>
    </div>
  )
}

export function EmptyState({ cols, msg }) {
  return (
    <tr>
      <td colSpan={cols}>
        <div className="py-10 dotted rounded-lg text-center text-ink3 text-sm">{msg}</div>
      </td>
    </tr>
  )
}
