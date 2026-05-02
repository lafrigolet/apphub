import { useEffect, useState } from 'react'
import { useApp } from '../../../shell/lib/context'
import { api } from '../../../shell/lib/api'
import { adaptAudit } from '../../../shell/lib/adapters'
import { fmtDate, relTime, actionLabel } from '../../../shell/lib/utils'
import { icons } from '../../../shell/lib/icons'

export default function TenantAudit() {
  const { role, identity, myTenant } = useApp()
  const [log, setLog] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!identity?.tenantId) return
    api.get(`/api/audit/?tenantId=${identity.tenantId}&limit=200`)
      .then((l) => setLog(l.map((a) => adaptAudit(a, { [identity.tenantId]: myTenant?.display_name ?? '—' }))))
      .catch(() => setLog([]))
      .finally(() => setLoading(false))
  }, [identity, myTenant])

  if (loading) return <div className="p-10 text-center text-ink3">Cargando…</div>

  const tenantName = myTenant?.display_name ?? '—'

  return (
    <div className="p-8 max-w-6xl fade-up">
      <div className="flex items-start justify-between gap-6 mb-8">
        <div>
          <div className="text-[12px] uppercase tracking-[0.18em] text-ink3 mb-2">{tenantName}</div>
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
          ? log.map((a) => (
            <div key={a.id} className="px-5 py-3 flex items-start gap-3">
              <span className="w-1.5 h-1.5 rounded-full mt-2 shrink-0" style={{ background: '#2C5280' }} />
              <div className="flex-1 min-w-0">
                <div className="text-[13.5px]">
                  {actionLabel(a.action)} · <span className="text-ink3">{a.actorRole || '—'}</span>
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
