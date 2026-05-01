import { useEffect, useState } from 'react'
import { useApp } from '../../context/AppContext'
import { api } from '../../lib/api'
import { adaptTenant, adaptUser, adaptAudit } from '../../lib/adapters'
import { APP_ID } from '../../lib/auth'
import { fmtDate, fmtMoney, fmtNumber, relTime, tenantColor, initials } from '../../lib/utils'
import { icons } from '../../lib/icons'
import { StatusBadge, StripeBadge, PlanBadge, RoleBadge, TwoFABadge, Avatar, DlRow, MiniMetric } from '../../lib/ui'
import { SuspendModal, ReactivateModal, ArchiveModal, RestoreModal, ExportModal } from './modals/TenantActionModals'
import { SplitpayConfigTabs } from './SplitpayPanels'

const TABS = [
  { k: 'identity', label: 'Identificación' },
  { k: 'state',    label: 'Estado y dominios' },
  { k: 'stripe',   label: 'Stripe Connect' },
  { k: 'admins',   label: 'Administradores' },
  { k: 'plan',     label: 'Plan y uso' },
  { k: 'audit',    label: 'Audit log' },
]

function TabIdentity({ t }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 bg-white border border-line rounded-xl shadow-card">
        <div className="px-5 py-4 border-b border-line flex items-center justify-between">
          <div className="font-display text-[20px]">Datos identificativos</div>
        </div>
        <dl className="divide-y divide-line">
          <DlRow label="Nombre comercial">{t.name}</DlRow>
          <DlRow label="Razón social">{t.legal || '—'}</DlRow>
          <DlRow label="Identificador fiscal"><span className="font-mono">{t.cif || '—'}</span></DlRow>
          <DlRow label="País">{t.country || '—'}</DlRow>
          <DlRow label="Email de contacto">{t.contactEmail
            ? <a href={`mailto:${t.contactEmail}`} className="text-info hover:underline">{t.contactEmail}</a>
            : '—'}</DlRow>
          <DlRow label="Teléfono">{t.contactPhone || '—'}</DlRow>
          <DlRow label="Dirección">{t.address || '—'}</DlRow>
        </dl>
      </div>
      <div className="space-y-4">
        <div className="bg-white border border-line rounded-xl shadow-card p-5">
          <div className="text-[11px] uppercase tracking-[0.14em] text-ink3 mb-3">Identificadores</div>
          <div className="space-y-2">
            {[['tenant_id', t.id], ['slug', t.subdomain], ['sub-tenancy', 'Deshabilitada']].map(([k, v]) => (
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
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-line rounded-xl shadow-card p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="font-display text-[20px]">Estado actual</div>
            <StatusBadge status={t.status} />
          </div>
          {t.status === 'SUSPENDED' && (
            <div className="bg-warnbg border border-warn/30 rounded-lg p-3 text-[13px] text-warn">
              Suspendido {t.suspendReason ? <>por <strong>{t.suspendReason}</strong></> : ''}. El tenant no puede operar hasta su reactivación.
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
          </div>
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <span className="text-ink3 mt-0.5">{icons.globe}</span>
              <div>
                <div className="text-[11px] uppercase tracking-[0.14em] text-ink3">Subdominio plataforma</div>
                <div className="text-[14px] font-mono mt-0.5">{t.subdomain}.voragine.app</div>
              </div>
            </div>
            <div className="border-t border-line" />
            <div className="flex items-start gap-3">
              <span className="text-ink3 mt-0.5">{icons.globe}</span>
              <div className="flex-1">
                <div className="text-[11px] uppercase tracking-[0.14em] text-ink3">Dominio propio</div>
                {t.customDomain
                  ? <div className="text-[14px] font-mono mt-0.5">{t.customDomain}</div>
                  : <div className="text-[13px] text-ink3 mt-0.5">No configurado</div>
                }
              </div>
            </div>
          </div>
        </div>
      </div>

      <EmailDomainsCard tenant={t} />
    </div>
  )
}

function statusBadgeClasses(status) {
  switch (status) {
    case 'verified':  return 'bg-okbg text-ok'
    case 'pending':   return 'bg-warnbg text-warn'
    case 'failed':    return 'bg-dangerbg text-danger'
    case 'suspended': return 'bg-paper2 text-ink3'
    default:          return 'bg-paper2 text-ink3'
  }
}

function EmailDomainsCard({ tenant }) {
  const { toast } = useApp()
  const [items, setItems] = useState(null)
  const [busyId, setBusyId] = useState(null)

  const scope = `?appId=${encodeURIComponent(tenant.app_id)}&tenantId=${encodeURIComponent(tenant.id)}`

  function reload() {
    setItems(null)
    api.get(`/api/notifications/email-domains${scope}`)
      .then((r) => setItems(r?.data ?? []))
      .catch((err) => { setItems([]); toast(err.message ?? 'Error', 'danger') })
  }

  useEffect(() => { reload() }, [tenant.id, tenant.app_id])

  async function reverify(id) {
    setBusyId(id)
    try {
      await api.post(`/api/notifications/email-domains/${id}/verify${scope}`, {})
      toast('Verificación solicitada')
      reload()
    } catch (err) { toast(err.message ?? 'Error', 'danger') }
    finally { setBusyId(null) }
  }

  async function suspend(id) {
    if (!window.confirm('Suspender este dominio? El tenant no podrá enviar correos desde él.')) return
    setBusyId(id)
    try {
      await api.post(`/api/notifications/email-domains/${id}/suspend${scope}`, {})
      toast('Dominio suspendido', 'warn')
      reload()
    } catch (err) { toast(err.message ?? 'Error', 'danger') }
    finally { setBusyId(null) }
  }

  return (
    <div className="bg-white border border-line rounded-xl shadow-card">
      <div className="px-5 py-4 border-b border-line flex items-center justify-between">
        <div>
          <div className="font-display text-[20px]">Dominios de email</div>
          <div className="text-xs text-ink3 mt-0.5">
            Sólo lectura · El owner del tenant configura sus dominios desde su portal.
          </div>
        </div>
      </div>
      {items === null
        ? <div className="p-6 text-center text-ink3 text-sm">Cargando…</div>
        : items.length === 0
          ? <div className="p-10 dotted text-center text-ink3 text-sm">El tenant no ha configurado ningún dominio de email.</div>
          : (
            <table className="t">
              <thead><tr><th>Dominio</th><th>Estado</th><th>From por defecto</th><th>Última verificación</th><th /></tr></thead>
              <tbody>
                {items.map((d) => (
                  <tr key={d.id}>
                    <td className="font-mono text-[13px]">{d.domain}</td>
                    <td><span className={`badge ${statusBadgeClasses(d.status)}`}>{d.status}</span></td>
                    <td className="text-[13px] text-ink2">
                      {d.default_from_local ? `${d.default_from_local}@${d.domain}` : <span className="text-ink3">—</span>}
                    </td>
                    <td className="text-[12.5px] text-ink3">{d.last_checked_at ? relTime(d.last_checked_at) : '—'}</td>
                    <td className="text-right whitespace-nowrap">
                      <button onClick={() => reverify(d.id)} disabled={busyId === d.id} className="btn btn-ghost btn-sm mr-1">Re-verificar</button>
                      {d.status !== 'suspended' && (
                        <button onClick={() => suspend(d.id)} disabled={busyId === d.id} className="btn btn-ghost btn-sm text-danger">Suspender</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
    </div>
  )
}

function TabStripe({ t, app }) {
  const { toast } = useApp()

  if (!app?.splitpay_enabled) {
    return (
      <div className="space-y-4">
        <div className="bg-white border border-line rounded-xl shadow-card">
          <div className="px-5 py-4 border-b border-line flex items-center justify-between">
            <div>
              <div className="font-display text-[20px]">Stripe Connect</div>
              <div className="text-xs text-ink3 mt-0.5">Cuenta asociada al tenant para procesar pagos con split</div>
            </div>
            <StripeBadge status={t.stripe} />
          </div>
          <dl className="divide-y divide-line">
            <DlRow label="Estado KYC"><StripeBadge status={t.stripe} /></DlRow>
            <DlRow label="Account ID"><span className="text-ink3 text-[12px]">No conectado</span></DlRow>
            <DlRow label="Application fee por defecto"><span className="font-mono">2.9% + 0,30 €</span></DlRow>
          </dl>
        </div>
        <div className="bg-paper2 border border-line rounded-xl p-5 text-[13px] text-ink2">
          <div className="font-medium mb-1">Split Pay no está habilitado para esta app</div>
          <div className="text-ink3">
            Para configurar Stripe Connect en este tenant primero habilita Split Pay en{' '}
            <span className="font-mono">{app?.app_id ?? t.app_id}</span> desde la sección Apps.
          </div>
        </div>
      </div>
    )
  }

  // Staff impersonation: backend's preHandler honours appId/tenantId query
  // params for staff/super_admin. Without this, splitpay would scope queries
  // to the staff member's own tenant instead of the tenant being viewed.
  const scopeQuery = `?appId=${encodeURIComponent(app.app_id)}&tenantId=${encodeURIComponent(t.id)}`

  return (
    <div className="space-y-4">
      <div className="bg-white border border-line rounded-xl shadow-card p-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-display text-[20px]">Stripe Connect</div>
            <div className="text-xs text-ink3 mt-0.5">
              Configurando como staff en nombre de <span className="font-medium text-ink">{t.name}</span>
            </div>
          </div>
          <StripeBadge status={t.stripe} />
        </div>
      </div>
      <SplitpayConfigTabs scopeQuery={scopeQuery} onToast={toast} />
    </div>
  )
}

function TabAdmins({ t, admins }) {
  const { toast } = useApp()
  return (
    <div className="space-y-6">
      <div className="bg-white border border-line rounded-xl shadow-card">
        <div className="px-5 py-4 border-b border-line flex items-center justify-between">
          <div>
            <div className="font-display text-[20px]">Administradores</div>
            <div className="text-xs text-ink3 mt-0.5">{admins.length} personas con acceso al tenant</div>
          </div>
          <button
            onClick={() => toast('Invitaciones disponibles próximamente', 'warn')}
            className="btn btn-ghost btn-sm"
          >
            {icons.info}Invitaciones: próximamente
          </button>
        </div>
        <table className="t">
          <thead><tr><th>Persona</th><th>Rol</th><th>2FA</th><th>Último acceso</th><th /></tr></thead>
          <tbody>
            {admins.length === 0 && (
              <tr><td colSpan={5} className="text-center text-ink3 py-6">Sin administradores todavía.</td></tr>
            )}
            {admins.map((a) => (
              <tr key={a.id}>
                <td>
                  <div className="flex items-center gap-3">
                    <Avatar name={a.name} color={a.avatar} />
                    <div>
                      <div className="font-medium">{a.name}</div>
                      <div className="text-xs text-ink3">{a.email}</div>
                    </div>
                  </div>
                </td>
                <td><RoleBadge role={a.role} /></td>
                <td><TwoFABadge enabled={a.twofa} /></td>
                <td className="text-[13px] text-ink3">{a.last ? relTime(a.last) : '—'}</td>
                <td className="text-right"><button className="text-ink3 hover:text-ink p-1">{icons.more}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
            <MiniMetric label="Ticket medio"      value={t.txMonth ? fmtMoney(Math.round(t.volMonth / t.txMonth)) : '—'} hint="por transacción" />
            <MiniMetric label="Application fee"   value={fmtMoney(Math.round(t.volMonth * 0.029 + t.txMonth * 0.3))} hint="comisión plataforma" />
          </div>
        </div>
      </div>
    </div>
  )
}

function TabAudit({ t, log }) {
  return (
    <div className="bg-white border border-line rounded-xl shadow-card">
      <div className="px-5 py-4 border-b border-line flex items-center justify-between">
        <div>
          <div className="font-display text-[20px]">Audit log</div>
          <div className="text-xs text-ink3 mt-0.5">Historial inmutable de acciones</div>
        </div>
      </div>
      <div className="divide-y divide-line">
        {log.length
          ? log.map((a) => (
            <div key={a.id} className="px-5 py-3 flex items-start gap-3">
              <span className="w-1.5 h-1.5 rounded-full mt-2 shrink-0" style={{ background: '#2C5280' }} />
              <div className="flex-1 min-w-0">
                <div className="text-[13.5px]">{a.action} · <span className="text-ink3">{a.actorRole}</span></div>
                <div className="text-xs text-ink3 mt-0.5">{a.detail || ''}</div>
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
  const { selectedTenant, tenantTab, setTenantTab, navigate, openModal } = useApp()
  const [t, setTenant] = useState(null)
  const [app, setApp] = useState(null)
  const [admins, setAdmins] = useState([])
  const [audit, setAudit] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    if (!selectedTenant) return
    setLoading(true)
    Promise.all([
      api.get(`/api/tenants/tenants/${selectedTenant}`).then(adaptTenant),
      api.get(`/api/users/?appId=${APP_ID}&tenantId=${selectedTenant}`).then((l) => l.map(adaptUser)),
      api.get(`/api/audit/?tenantId=${selectedTenant}`).then((l) => l.map((a) => adaptAudit(a))),
    ])
      .then(([tenant, adm, a]) => {
        setTenant(tenant); setAdmins(adm); setAudit(a)
        // Lazy-load the app of this tenant so TabStripe knows splitpay_enabled
        if (tenant?.app_id) {
          api.get(`/api/apps/${tenant.app_id}`).then(setApp).catch(() => setApp(null))
        }
      })
      .catch(() => setTenant(null))
      .finally(() => setLoading(false))
  }, [selectedTenant, refreshKey])

  const refresh = () => setRefreshKey((k) => k + 1)

  if (loading) return <div className="p-10 text-center text-ink3">Cargando…</div>
  if (!t) return <div className="p-10">Tenant no encontrado.</div>

  const color = tenantColor(t.id)

  function tabContent() {
    switch (tenantTab) {
      case 'identity': return <TabIdentity t={t} />
      case 'state':    return <TabState t={t} />
      case 'stripe':   return <TabStripe t={t} app={app} />
      case 'admins':   return <TabAdmins t={t} admins={admins} />
      case 'plan':     return <TabPlan t={t} />
      case 'audit':    return <TabAudit t={t} log={audit} />
    }
  }

  return (
    <div className="p-8 max-w-7xl fade-up">
      <div className="flex items-center gap-1.5 text-[13px] text-ink3 mb-4">
        <button onClick={() => { navigate('tenants'); }} className="hover:text-ink">Tenants</button>
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
              {t.customDomain && <><span>·</span><span className="flex items-center gap-1">{t.customDomain}</span></>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {t.status === 'ACTIVE'    && <button onClick={() => openModal(<SuspendModal tenant={t} onDone={refresh} />)}     className="btn btn-ghost btn-sm">{icons.pause}Suspender</button>}
          {t.status === 'SUSPENDED' && <button onClick={() => openModal(<ReactivateModal tenant={t} onDone={refresh} />)} className="btn btn-ghost btn-sm">{icons.play}Reactivar</button>}
          {['ACTIVE','SUSPENDED'].includes(t.status) && <button onClick={() => openModal(<ArchiveModal tenant={t} onDone={refresh} />)} className="btn btn-ghost btn-sm">{icons.archive}Archivar</button>}
          {t.status === 'ARCHIVED'  && <button onClick={() => openModal(<RestoreModal tenant={t} onDone={refresh} />)}    className="btn btn-ghost btn-sm">{icons.play}Restaurar</button>}
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
