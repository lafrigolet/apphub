import { AUDIT } from '../../data/mock'
import { fmtDate, relTime, actionLabel, actionColor } from '../../lib/utils'
import { icons } from '../../lib/icons'
import { Avatar } from '../../lib/ui'

export default function AuditGlobal() {
  return (
    <div className="p-8 max-w-7xl fade-up">
      <div className="flex items-start justify-between gap-6 mb-8">
        <div>
          <div className="text-[12px] uppercase tracking-[0.18em] text-ink3 mb-2">Plataforma</div>
          <h1 className="font-display text-[44px] leading-none tracking-tight">
            <span className="italic font-normal">Audit log</span> global
          </h1>
          <p className="text-ink3 mt-3 max-w-xl">
            Todas las acciones administrativas en todos los tenants. Entradas inmutables. Retención mínima: 2 años.
          </p>
        </div>
        <button className="btn btn-ghost shrink-0">{icons.download}Exportar CSV</button>
      </div>

      <div className="bg-white border border-line rounded-xl shadow-card overflow-hidden">
        <table className="t">
          <thead>
            <tr>
              <th>Cuándo</th>
              <th>Actor</th>
              <th>Acción</th>
              <th>Tenant</th>
              <th>Detalle</th>
              <th>IP</th>
            </tr>
          </thead>
          <tbody>
            {AUDIT.map((a, i) => (
              <tr key={i}>
                <td className="text-[13px] text-ink3 whitespace-nowrap">{fmtDate(a.ts, true)}</td>
                <td>
                  <div className="flex items-center gap-2">
                    <Avatar name={a.actor} color="#14131A" />
                    <div>
                      <div className="text-[13px] font-medium">{a.actor}</div>
                      <div className="text-[11px] text-ink3">{a.actorRole}</div>
                    </div>
                  </div>
                </td>
                <td>
                  <span className="inline-flex items-center gap-2 text-[13px]">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: actionColor(a.action) }} />
                    {actionLabel(a.action)}
                  </span>
                </td>
                <td><span className="font-mono text-[12px]">{a.tenantName}</span></td>
                <td className="text-[13px] text-ink3">{a.detail}</td>
                <td className="font-mono text-[12px] text-ink3">{a.ip}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
