import { useApp } from '../../context/AppContext'
import { TENANTS, ADMINS_BY_TENANT, INVITES_BY_TENANT, AUDIT } from '../../data/mock'
import { fmtDate, fmtMoney, fmtNumber, relTime, tenantColor, initials } from '../../lib/utils'
import { icons } from '../../lib/icons'
import { StatusBadge, StripeBadge, PlanBadge, RoleBadge, TwoFABadge, Avatar, DlRow, MiniMetric } from '../../lib/ui'
import { SuspendModal, ReactivateModal, ArchiveModal, RestoreModal, ExportModal } from './modals/TenantActionModals'

function mockAdmins(t) {
  return [
    { id: 'o', name: 'Owner del tenant', email: 'owner@' + t.subdomain + '.com', role: 'OWNER', twofa: true,  last: '2026-04-20T12:00:00Z', avatar: '#2F6F4F' },
    { id: 'a', name: 'Admin del tenant', email: 'admin@' + t.subdomain + '.com', role: 'ADMIN', twofa: true,  last: '2026-04-18T10:00:00Z', avatar: '#2C5280' },
  ]
}

const TABS = [
  { k: 'identity', label: 'Identificación' },
  { k: 'state',    label: 'Estado y dominios' },
  { k: 'stripe',   label: 'Stripe Connect' },
  { k: 'admins',   label: 'Administradores' },
  { k: 'plan',     label: 'Plan y uso' },
  { k: 'audit',    label: 'Audit log' },
]

function TabIdentity({ t }) {
  const { toast } = useApp()
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 bg-white border border-line rounded-xl shadow-card">
        <div className="px-5 py-4 border-b border-line flex items-center justify-between">
          <div className="font-display text-[20px]">Datos identificativos</div>
          <button className="btn btn-ghost btn-sm" onClick={() => toast('Modo edición — editable por Staff')}>Editar</button>
        </div>
        <dl className="divide-y divide-line">
          <DlRow label="Nombre comercial">{t.name}</DlRow>
          <DlRow label="Razón social">{t.legal}</DlRow>
          <DlRow label="Identificador fiscal"><span className="font-mono">{t.cif}</span></DlRow>
          <DlRow label="País">{t.country}</DlRow>
          <DlRow label="Email de contacto"><a href="#" className="text-info hover:underline">contacto@{t.subdomain}.com</a></DlRow>
          <DlRow label="Teléfono">+34 900 000 000</DlRow>
          <DlRow label="Dirección">Calle Ejemplo 42, 28001 Madrid, ES</DlRow>
        </dl>
      </div>
      <div className="space-y-4">
        <div className="bg-white border border-line rounded-xl shadow-card p-5">
          <div className="text-[11px] uppercase tracking-[0.14em] text-ink3 mb-3">Identificadores</div>
          <div className="space-y-2">
            {[['tenant_id', t.id], ['slug', t.subdomain], ['sub-tenancy', t.subTenants ? 'Habilitada' : 'Deshabilitada']].map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-2">
                <span className="text-[12px] text-ink3">{k}</span>
                <code className="font-mono text-[12px] bg-paper2 px-2 py-0.5 rounded">{v}</code>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-white border border-line rounded-xl shadow-card p-5">
          <div className="text-[11px] uppercase tracking-[0.14em] text-ink3 mb-2">Creado</div>
          <div className="text-[14px] font-medium">{fmtDate(t.created)}</div>
          <div className="text-[12px] text-ink3 mt-0.5">
            {Math.floor((Date.now() - new Date(t.created)) / 86400000)} días en la plataforma
          </div>
        </div>
      </div>
    </div>
  )
}

function TabState({ t }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="bg-white border border-line rounded-xl shadow-card p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="font-display text-[20px]">Estado actual</div>
          <StatusBadge status={t.status} />
        </div>
        {t.status === 'SUSPENDED' && (
          <div className="bg-warnbg border border-warn/30 rounded-lg p-3 text-[13px] text-warn">
            Suspendido por <strong>{t.suspendReason}</strong>. El tenant no puede operar hasta su reactivación.
          </div>
        )}
        {t.status === 'ARCHIVED' && (
          <div className="bg-paper2 border border-line rounded-lg p-3 text-[13px] text-ink2">
            Archivado el {fmtDate(t.archivedAt)}. Retención: <strong>90 días</strong>.
          </div>
        )}
        <div className="mt-6">
          <div className="text-[11px] uppercase tracking-[0.14em] text-ink3 mb-3">Línea de estado</div>
          <div className="flex items-center gap-2 text-[12px]">
            <span className="badge bg-okbg text-ok"><span className="dot" style={{ background: '#2F6F4F' }} />Creado</span>
            <span className="text-ink3">{icons.chevronR}</span>
            <span className="badge bg-okbg text-ok"><span className="dot" style={{ background: '#2F6F4F' }} />Activo</span>
            {t.status !== 'ACTIVE' && <><span className="text-ink3">{icons.chevronR}</span><StatusBadge status={t.status} /></>}
          </div>
        </div>
      </div>
      <div className="bg-white border border-line rounded-xl shadow-card p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="font-display text-[20px]">Dominios</div>
          <button className="btn btn-ghost btn-sm">Gestionar</button>
        </div>
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <span className="text-ink3 mt-0.5">{icons.globe}</span>
            <div>
              <div className="text-[11px] uppercase tracking-[0.14em] text-ink3">Subdominio plataforma</div>
              <div className="text-[14px] font-mono mt-0.5">{t.subdomain}.voragine.app</div>
              <div className="text-[11.5px] text-ok mt-0.5 flex items-center gap-1">{icons.check} TLS activo · Wildcard cert</div>
            </div>
          </div>
          <div className="border-t border-line" />
          <div className="flex items-start gap-3">
            <span className="text-ink3 mt-0.5">{icons.globe}</span>
            <div className="flex-1">
              <div className="text-[11px] uppercase tracking-[0.14em] text-ink3">Dominio propio</div>
              {t.customDomain
                ? <><div className="text-[14px] font-mono mt-0.5">{t.customDomain}</div><div className="text-[11.5px] text-ok mt-0.5 flex items-center gap-1">{icons.check} Let's Encrypt · Verificado</div></>
                : <><div className="text-[13px] text-ink3 mt-0.5">No configurado</div><button className="btn btn-ghost btn-sm mt-2">{icons.plus}Añadir dominio</button></>
              }
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function TabStripe({ t }) {
  return (
    <div className="bg-white border border-line rounded-xl shadow-card">
      <div className="px-5 py-4 border-b border-line flex items-center justify-between">
        <div>
          <div className="font-display text-[20px]">Stripe Connect</div>
          <div className="text-xs text-ink3 mt-0.5">Cuenta asociada al tenant para procesar pagos con split</div>
        </div>
        <StripeBadge status={t.stripe} />
      </div>
      <dl className="divide-y divide-line">
        <DlRow label="Account ID"><span className="font-mono">acct_1PqN8X2...{t.id.slice(-3)}</span></DlRow>
        <DlRow label="Modo">{t.stripe === 'VERIFIED' ? <span className="badge bg-okbg text-ok">live</span> : <span className="badge bg-warnbg text-warn">test</span>}</DlRow>
        <DlRow label="Charges enabled">{t.stripe === 'VERIFIED' ? <span className="text-ok">Sí</span> : <span className="text-warn">No</span>}</DlRow>
        <DlRow label="Payouts enabled">{t.stripe === 'VERIFIED' ? <span className="text-ok">Sí</span> : <span className="text-warn">No</span>}</DlRow>
        <DlRow label="Application fee por defecto"><span className="font-mono">2.9% + 0,30 €</span></DlRow>
        <DlRow label="Calendario de payouts">Diario · T+2</DlRow>
        <DlRow label="Requirements pendientes">{t.stripe === 'RESTRICTED' ? <span className="text-warn">3 documentos requeridos</span> : <span className="text-ink3">Ninguno</span>}</DlRow>
      </dl>
    </div>
  )
}

function TabAdmins({ t }) {
  const { toast } = useApp()
  const admins = ADMINS_BY_TENANT[t.id] || mockAdmins(t)
  const invites = INVITES_BY_TENANT[t.id] || []
  return (
    <div className="space-y-6">
      <div className="bg-white border border-line rounded-xl shadow-card">
        <div className="px-5 py-4 border-b border-line flex items-center justify-between">
          <div>
            <div className="font-display text-[20px]">Administradores</div>
            <div className="text-xs text-ink3 mt-0.5">{admins.length} personas con acceso al tenant</div>
          </div>
          <button onClick={() => toast('Solo Owner/Admin del tenant pueden invitar — cambia de persona para probarlo', 'warn')} className="btn btn-ghost btn-sm">
            {icons.info}Gestión desde Owner/Admin
          </button>
        </div>
        <table className="t">
          <thead><tr><th>Persona</th><th>Rol</th><th>2FA</th><th>Último acceso</th><th /></tr></thead>
          <tbody>
            {admins.map(a => (
              <tr key={a.id}>
                <td><div className="flex items-center gap-3"><Avatar name={a.name} color={a.avatar} /><div><div className="font-medium">{a.name}</div><div className="text-xs text-ink3">{a.email}</div></div></div></td>
                <td><RoleBadge role={a.role} /></td>
                <td><TwoFABadge enabled={a.twofa} /></td>
                <td className="text-[13px] text-ink3">{relTime(a.last)}</td>
                <td className="text-right"><button className="text-ink3 hover:text-ink p-1">{icons.more}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {invites.length > 0 && (
        <div className="bg-white border border-line rounded-xl shadow-card">
          <div className="px-5 py-4 border-b border-line">
            <div className="font-display text-[20px]">Invitaciones pendientes</div>
            <div className="text-xs text-ink3 mt-0.5">Aún no aceptadas · {invites.length}</div>
          </div>
          <table className="t">
            <thead><tr><th>Email</th><th>Rol</th><th>Enviada</th><th>Expira</th><th /></tr></thead>
            <tbody>
              {invites.map(i => (
                <tr key={i.id}>
                  <td className="font-mono text-[13px]">{i.email}</td>
                  <td><RoleBadge role={i.role} /></td>
                  <td className="text-[13px] text-ink3">{fmtDate(i.sent)}</td>
                  <td className="text-[13px] text-ink3">{fmtDate(i.expires)}</td>
                  <td className="text-right"><span className="text-[12px] text-ink3">PENDING</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function TabPlan({ t }) {
  const limit = t.plan === 'STARTER' ? 50000 : t.plan === 'PRO' ? 250000 : 2000000
  const pct   = Math.min(100, Math.round((t.volMonth / limit) * 100))
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 bg-white border border-line rounded-xl shadow-card p-5">
        <div className="flex items-center justify-between mb-5">
          <div className="font-display text-[20px]">Plan actual</div>
          <PlanBadge plan={t.plan} />
        </div>
        <div className="space-y-5">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-[13px] text-ink2">Volumen procesado este mes</div>
              <div className="text-[13px] font-mono">{fmtMoney(t.volMonth)} <span className="text-ink3">/ {fmtMoney(limit)}</span></div>
            </div>
            <div className="h-1.5 w-full bg-paper2 rounded-full overflow-hidden">
              <div className="h-full bg-accent rounded-full" style={{ width: `${pct}%` }} />
            </div>
            <div className="text-[11.5px] text-ink3 mt-1">{pct}% del límite del plan</div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <MiniMetric label="Transacciones"     value={fmtNumber(t.txMonth)}  hint="este mes" />
            <MiniMetric label="Ticket medio"       value={t.txMonth ? fmtMoney(Math.round(t.volMonth / t.txMonth)) : '—'} hint="por transacción" />
            <MiniMetric label="Application fee"   value={fmtMoney(Math.round(t.volMonth * 0.029 + t.txMonth * 0.3))} hint="comisión plataforma" />
          </div>
        </div>
      </div>
      <div className="bg-white border border-line rounded-xl shadow-card p-5">
        <div className="text-[11px] uppercase tracking-[0.14em] text-ink3 mb-3">Facturación</div>
        <div className="space-y-3 text-[13px]">
          <div className="flex items-center justify-between"><span className="text-ink3">Próxima factura</span><span>{fmtDate('2026-05-01')}</span></div>
          <div className="flex items-center justify-between"><span className="text-ink3">Importe estimado</span><span className="font-mono">{fmtMoney(149)}</span></div>
          <div className="flex items-center justify-between"><span className="text-ink3">Método</span><span>Visa •••• 4242</span></div>
        </div>
        <button className="btn btn-ghost btn-sm w-full mt-4 justify-center">Ver historial</button>
      </div>
    </div>
  )
}

function TabAudit({ t }) {
  const log = AUDIT.filter(a => a.tenant === t.id)
  return (
    <div className="bg-white border border-line rounded-xl shadow-card">
      <div className="px-5 py-4 border-b border-line flex items-center justify-between">
        <div>
          <div className="font-display text-[20px]">Audit log</div>
          <div className="text-xs text-ink3 mt-0.5">Historial inmutable de acciones</div>
        </div>
        <button className="btn btn-ghost btn-sm">{icons.download}Exportar CSV</button>
      </div>
      <div className="divide-y divide-line">
        {log.length
          ? log.map((a, i) => (
            <div key={i} className="px-5 py-3 flex items-start gap-3">
              <span className="w-1.5 h-1.5 rounded-full mt-2 shrink-0" style={{ background: '#2C5280' }} />
              <div className="flex-1 min-w-0">
                <div className="text-[13.5px]"><span className="font-medium">{a.actor}</span> · {a.action} · <span className="font-mono text-[12px]">{a.tenantName}</span></div>
                <div className="text-xs text-ink3 mt-0.5">{a.detail}</div>
              </div>
              <div className="text-xs text-ink3 whitespace-nowrap">{relTime(a.ts)}</div>
            </div>
          ))
          : <div className="p-10 dotted text-center text-ink3 text-sm">Sin actividad registrada para este tenant.</div>
        }
      </div>
    </div>
  )
}

export default function TenantDetail() {
  const { selectedTenant, tenantTab, setTenantTab, navigate, openModal, toast } = useApp()
  const t = TENANTS.find(x => x.id === selectedTenant)
  if (!t) return <div className="p-10">Tenant no encontrado.</div>

  const color = tenantColor(t.id)

  function tabContent() {
    switch (tenantTab) {
      case 'identity': return <TabIdentity t={t} />
      case 'state':    return <TabState t={t} />
      case 'stripe':   return <TabStripe t={t} />
      case 'admins':   return <TabAdmins t={t} />
      case 'plan':     return <TabPlan t={t} />
      case 'audit':    return <TabAudit t={t} />
    }
  }

  return (
    <div className="p-8 max-w-7xl fade-up">
      <div className="flex items-center gap-1.5 text-[13px] text-ink3 mb-4">
        <button onClick={() => navigate('tenants')} className="hover:text-ink">Tenants</button>
        <span>{icons.chevronR}</span>
        <span className="text-ink">{t.name}</span>
      </div>

      <div className="flex items-start justify-between gap-6 mb-6">
        <div className="flex items-start gap-4">
          <span className="avatar" style={{ width: 56, height: 56, fontSize: 18, background: `${color}20`, color, border: `1px solid ${color}30` }}>
            {initials(t.name)}
          </span>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="font-display text-[34px] leading-tight tracking-tight">{t.name}</h1>
              <StatusBadge status={t.status} />
              <PlanBadge plan={t.plan} />
            </div>
            <div className="flex items-center gap-3 mt-1 text-[13px] text-ink3">
              <span className="font-mono">{t.id}</span>
              <span>·</span>
              <span>{t.subdomain}.voragine.app</span>
              {t.customDomain && <><span>·</span><a href="#" className="hover:text-ink flex items-center gap-1">{t.customDomain} {icons.external}</a></>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {t.status === 'ACTIVE'    && <button onClick={() => openModal(<SuspendModal tenant={t} />)}     className="btn btn-ghost btn-sm">{icons.pause}Suspender</button>}
          {t.status === 'SUSPENDED' && <button onClick={() => openModal(<ReactivateModal tenant={t} />)} className="btn btn-ghost btn-sm">{icons.play}Reactivar</button>}
          {['ACTIVE','SUSPENDED'].includes(t.status) && <button onClick={() => openModal(<ArchiveModal tenant={t} />)} className="btn btn-ghost btn-sm">{icons.archive}Archivar</button>}
          {t.status === 'ARCHIVED'  && <button onClick={() => openModal(<RestoreModal tenant={t} />)}    className="btn btn-ghost btn-sm">{icons.play}Restaurar</button>}
          <button onClick={() => openModal(<ExportModal />)} className="btn btn-ghost btn-sm">{icons.download}Exportar datos</button>
        </div>
      </div>

      <div className="border-b border-line mb-6">
        <div className="flex">
          {TABS.map(tb => (
            <div key={tb.k} className={`tab ${tenantTab === tb.k ? 'active' : ''}`} onClick={() => setTenantTab(tb.k)}>
              {tb.label}
            </div>
          ))}
        </div>
      </div>

      {tabContent()}
    </div>
  )
}
