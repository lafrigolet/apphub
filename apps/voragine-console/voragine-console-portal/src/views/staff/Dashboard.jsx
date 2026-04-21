import { useApp } from '../../context/AppContext'
import { TENANTS, AUDIT } from '../../data/mock'
import { fmtMoney, fmtNumber, relTime, fmtDate, actionLabel, actionColor } from '../../lib/utils'
import { icons } from '../../lib/icons'
import { Kpi, Avatar } from '../../lib/ui'

function AuditRow({ a }) {
  return (
    <div className="px-5 py-3 flex items-start gap-3">
      <span className="w-1.5 h-1.5 rounded-full mt-2 shrink-0" style={{ background: actionColor(a.action) }} />
      <div className="flex-1 min-w-0">
        <div className="text-[13.5px]">
          <span className="font-medium">{a.actor}</span>
          {' · '}
          {actionLabel(a.action)}
          {' · '}
          <span className="font-mono text-[12px]">{a.tenantName}</span>
        </div>
        <div className="text-xs text-ink3 mt-0.5">{a.detail}</div>
      </div>
      <div className="text-xs text-ink3 whitespace-nowrap" title={fmtDate(a.ts, true)}>
        {relTime(a.ts)}
      </div>
    </div>
  )
}

export default function StaffDashboard() {
  const { navigate } = useApp()
  const total     = TENANTS.length
  const active    = TENANTS.filter(t => t.status === 'ACTIVE').length
  const suspended = TENANTS.filter(t => t.status === 'SUSPENDED').length
  const archived  = TENANTS.filter(t => t.status === 'ARCHIVED').length
  const volume    = TENANTS.reduce((a, t) => a + t.volMonth, 0)
  const tx        = TENANTS.reduce((a, t) => a + t.txMonth, 0)

  return (
    <div className="p-8 max-w-7xl fade-up">
      <div className="mb-8">
        <div className="text-[12px] uppercase tracking-[0.18em] text-ink3 mb-2">Dashboard</div>
        <h1 className="font-display text-[44px] leading-none tracking-tight">
          <span className="italic font-normal">Estado</span> de la plataforma
        </h1>
        <p className="text-ink3 mt-3 max-w-xl">Vista consolidada de todos los tenants activos, su operativa de pagos y la salud del servicio.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
        <Kpi label="Tenants totales" value={fmtNumber(total)}    hint={`${active} activos · ${suspended} suspendidos · ${archived} archivados`} />
        <Kpi label="Volumen del mes"  value={fmtMoney(volume)}   hint="GMV en € procesado vía Connect" />
        <Kpi label="Transacciones"    value={fmtNumber(tx)}      hint="Último periodo 30d" />
        <Kpi label="Health"           value="OK"                 hint="99.98% uptime · 0 incidents" tone="ok" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white border border-line rounded-xl shadow-card">
          <div className="px-5 py-4 border-b border-line flex items-center justify-between">
            <div>
              <div className="font-display text-[20px] tracking-tight">Actividad reciente</div>
              <div className="text-xs text-ink3 mt-0.5">Últimas acciones administrativas</div>
            </div>
            <button onClick={() => navigate('audit')} className="text-[13px] text-ink2 hover:text-ink flex items-center gap-1.5">
              Ver todo {icons.arrow}
            </button>
          </div>
          <div className="divide-y divide-line">
            {AUDIT.slice(0, 6).map((a, i) => <AuditRow key={i} a={a} />)}
          </div>
        </div>

        <div className="bg-white border border-line rounded-xl shadow-card">
          <div className="px-5 py-4 border-b border-line">
            <div className="font-display text-[20px] tracking-tight">Alertas</div>
            <div className="text-xs text-ink3 mt-0.5">Atención requerida</div>
          </div>
          <div className="p-5 space-y-3">
            <div className="border border-warnbg bg-[#FAF6E8] rounded-lg p-3">
              <div className="flex items-start gap-2">
                <span className="text-warn mt-0.5">{icons.info}</span>
                <div>
                  <div className="text-[13px] font-medium">Marketplace Norte · KYC restringido</div>
                  <div className="text-xs text-ink3 mt-1">Stripe requiere actualización de documentos.</div>
                </div>
              </div>
            </div>
            <div className="border border-dangerbg bg-[#F9ECEB] rounded-lg p-3">
              <div className="flex items-start gap-2">
                <span className="text-danger mt-0.5">{icons.info}</span>
                <div>
                  <div className="text-[13px] font-medium">CasaVerde · suspendido por seguridad</div>
                  <div className="text-xs text-ink3 mt-1">Incidente abierto desde hace 2 días.</div>
                </div>
              </div>
            </div>
            <div className="border border-infobg bg-[#EEF2F8] rounded-lg p-3">
              <div className="flex items-start gap-2">
                <span className="text-info mt-0.5">{icons.info}</span>
                <div>
                  <div className="text-[13px] font-medium">FoodHub · KYC pendiente</div>
                  <div className="text-xs text-ink3 mt-1">Onboarding iniciado hace 6 días.</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
