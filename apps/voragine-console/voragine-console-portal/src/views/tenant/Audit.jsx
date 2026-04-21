import { useApp } from '../../context/AppContext'
import { AUDIT } from '../../data/mock'
import { fmtDate, relTime, actionLabel } from '../../lib/utils'
import { icons } from '../../lib/icons'

export default function TenantAudit() {
  const { role, currentTenant } = useApp()
  const t = currentTenant()
  const log = AUDIT.filter(a => a.tenant === t.id)

  return (
    <div className="p-8 max-w-6xl fade-up">
      <div className="flex items-start justify-between gap-6 mb-8">
        <div>
          <div className="text-[12px] uppercase tracking-[0.18em] text-ink3 mb-2">{t.name}</div>
          <h1 className="font-display text-[44px] leading-none tracking-tight">
            <span className="italic font-normal">Audit log</span>
          </h1>
          <p className="text-ink3 mt-3 max-w-xl">
            Historial inmutable de acciones realizadas en tu tenant por cualquier admin o miembro del staff de Voragine.
          </p>
        </div>
        {role === 'owner' && (
          <button className="btn btn-ghost shrink-0">{icons.download}Exportar CSV</button>
        )}
      </div>

      <div className="bg-white border border-line rounded-xl shadow-card divide-y divide-line">
        {log.length
          ? log.map((a, i) => (
            <div key={i} className="px-5 py-3 flex items-start gap-3">
              <span className="w-1.5 h-1.5 rounded-full mt-2 shrink-0" style={{ background: '#2C5280' }} />
              <div className="flex-1 min-w-0">
                <div className="text-[13.5px]">
                  <span className="font-medium">{a.actor}</span> · {actionLabel(a.action)} · <span className="font-mono text-[12px]">{a.tenantName}</span>
                </div>
                <div className="text-xs text-ink3 mt-0.5">{a.detail}</div>
              </div>
              <div className="text-xs text-ink3 whitespace-nowrap" title={fmtDate(a.ts, true)}>
                {relTime(a.ts)}
              </div>
            </div>
          ))
          : <div className="p-10 dotted text-center text-ink3 text-sm">Sin actividad registrada.</div>
        }
      </div>
    </div>
  )
}
