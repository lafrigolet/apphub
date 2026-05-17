import { useEffect, useState } from 'react'
import { useApp } from '../../context/AppContext'
import { api } from '../../lib/api'
import { adaptTenant, adaptUser, adaptAudit } from '../../lib/adapters'
import { fmtDate, fmtMoney, fmtNumber, relTime, tenantColor, initials } from '../../lib/utils'
import { icons } from '../../lib/icons'
import { StatusBadge, StripeBadge, PlanBadge, RoleBadge, TwoFABadge, Avatar, DlRow, MiniMetric } from '../../lib/ui'
import { SuspendModal, ReactivateModal, ArchiveModal, RestoreModal, ExportModal } from './modals/TenantActionModals'
import { SplitpayConfigTabs } from './SplitpayPanels'
import EmailDomainsManager from '../../components/EmailDomainsManager'
import SubscriptionPanel from './SubscriptionPanel'

const TABS = [
  { k: 'identity',     label: 'Identificación' },
  { k: 'state',        label: 'Estado y dominios' },
  { k: 'stripe',       label: 'Stripe Connect' },
  { k: 'admins',       label: 'Administradores' },
  { k: 'subscription', label: 'Subscripción' },
  { k: 'audit',        label: 'Audit log' },
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
          <DlRow label="Idioma por defecto"><span className="font-mono uppercase">{t.defaultLocale ?? 'es'}</span></DlRow>
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

      <div className="bg-white border border-line rounded-xl shadow-card">
        <div className="px-5 py-4 border-b border-line">
          <div className="font-display text-[20px]">Dominios de email</div>
          <div className="text-xs text-ink3 mt-0.5">
            Configurando como staff en nombre de <span className="font-medium text-ink">{t.name}</span>.
            Los cambios se aplican al tenant.
          </div>
        </div>
        <div className="p-5">
          <EmailDomainsManager
            scopeQuery={`?appId=${encodeURIComponent(t.app_id)}&tenantId=${encodeURIComponent(t.id)}`}
            canSuspend
            compact
          />
        </div>
      </div>
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

// Generates a strong random password used as a temporary credential while
// the invitee completes the set-password flow via the magic-link email.
// Same pattern as CreateAppModal — never shown in the UI, never logged.
function randomTempPassword() {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, '').slice(0, 32) + 'A1!'
}

function InviteAdminModal({ tenant, onDone }) {
  const { closeModal, toast } = useApp()
  const [email, setEmail]             = useState('')
  const [displayName, setDisplayName] = useState('')
  const [role, setRole]               = useState('admin')
  const [busy, setBusy]               = useState(false)
  const [error, setError]             = useState(null)

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      // 1. Crear el user con password aleatoria. La password queda como
      //    bcrypt hash en DB; nadie la sabe — el invitado la fija él
      //    mismo desde el magic-link.
      await api.post('/api/auth/register', {
        appId:    tenant.app_id,
        tenantId: tenant.id,
        email:    email.trim(),
        password: randomTempPassword(),
        role,
      })
      // 2. Disparar forgot-password → genera token + dispatcha email vía
      //    notifications module (Resend).
      await api.post('/api/auth/forgot-password', {
        appId:    tenant.app_id,
        tenantId: tenant.id,
        email:    email.trim(),
      })
      // 3. Si el invitado tiene displayName, opcionalmente actualizarlo.
      //    No bloquea el flujo — si falla, el user queda con email como nombre.
      // (El endpoint PATCH /v1/users/me sólo permite que el propio user se
      //  actualice; aún no hay PATCH /v1/users/:id para staff. Lo dejamos
      //  para iteración futura; ahora el displayName se cogerá la primera
      //  vez que el invitado entre.)
      toast(`Invitación enviada a ${email}`)
      onDone?.()
      closeModal()
    } catch (err) {
      // Error típico: 409 si el email ya existe en (app_id, tenant_id).
      setError(err.message ?? 'No se pudo invitar al admin')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="p-6 border-b border-line">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-display text-[22px]">Invitar administrador</div>
            <div className="text-[13px] text-ink3 mt-1">
              El invitado recibirá un email para fijar su contraseña.
            </div>
          </div>
          <button onClick={closeModal} className="text-ink3 hover:text-ink">{icons.close}</button>
        </div>
      </div>
      <form className="p-6 space-y-4" onSubmit={submit}>
        <div>
          <div className="label mb-1.5">Email</div>
          <input
            type="email" required value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="input" autoComplete="off" autoFocus
          />
        </div>
        <div>
          <div className="label mb-1.5">Nombre (opcional)</div>
          <input
            type="text" value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="input"
            placeholder="Cómo se mostrará en la consola"
          />
        </div>
        <div>
          <div className="label mb-1.5">Rol</div>
          <select className="select" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="admin">admin</option>
            <option value="owner">owner</option>
          </select>
        </div>
        {error && <div className="bg-dangerbg border border-line rounded-lg p-3 text-[12.5px] text-danger">{error}</div>}
        <div className="flex items-center justify-end gap-2 pt-2">
          <button type="button" onClick={closeModal} className="btn btn-ghost">Cancelar</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Enviando…' : 'Enviar invitación'}
          </button>
        </div>
      </form>
    </>
  )
}

function ChangeRoleModal({ user, onDone }) {
  const { closeModal, toast } = useApp()
  const [role, setRole]   = useState(String(user.role).toLowerCase())
  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState(null)

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      await api.patch(`/api/users/${user.id}/role`, { role })
      toast(`Rol de ${user.name} actualizado a ${role}`)
      onDone?.()
      closeModal()
    } catch (err) {
      setError(err.message ?? 'No se pudo cambiar el rol')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="p-6 border-b border-line">
        <div className="flex items-center justify-between">
          <div className="font-display text-[22px]">Cambiar rol de {user.name}</div>
          <button onClick={closeModal} className="text-ink3 hover:text-ink">{icons.close}</button>
        </div>
      </div>
      <form className="p-6 space-y-4" onSubmit={submit}>
        <div>
          <div className="label mb-1.5">Rol actual</div>
          <RoleBadge role={user.role} />
        </div>
        <div>
          <div className="label mb-1.5">Nuevo rol</div>
          <select className="select" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="admin">admin</option>
            <option value="owner">owner</option>
            <option value="user">user</option>
          </select>
        </div>
        {error && <div className="bg-dangerbg border border-line rounded-lg p-3 text-[12.5px] text-danger">{error}</div>}
        <div className="flex items-center justify-end gap-2 pt-2">
          <button type="button" onClick={closeModal} className="btn btn-ghost">Cancelar</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button>
        </div>
      </form>
    </>
  )
}

function RevokeAdminModal({ tenant, user, onDone }) {
  const { closeModal, toast } = useApp()
  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState(null)

  async function confirm() {
    setBusy(true); setError(null)
    try {
      await api.delete(`/api/users/${user.id}`)
      toast(`${user.name} revocado`)
      onDone?.()
      closeModal()
    } catch (err) {
      setError(err.message ?? 'No se pudo revocar')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="p-6 border-b border-line">
        <div className="flex items-center justify-between">
          <div className="font-display text-[22px]">Revocar acceso</div>
          <button onClick={closeModal} className="text-ink3 hover:text-ink">{icons.close}</button>
        </div>
      </div>
      <div className="p-6 space-y-4">
        <p className="text-[14px]">
          Vas a revocar a <strong>{user.name}</strong> ({user.email}) de <strong>{tenant.name}</strong>.
          Pierde acceso inmediatamente. Sus tokens activos quedan invalidados.
        </p>
        <p className="text-[13px] text-ink3">
          La fila queda con <code className="font-mono">revoked_at</code> marcado — no se borra para
          preservar el audit log. Puedes re-invitar el mismo email después si lo necesitas.
        </p>
        {error && <div className="bg-dangerbg border border-line rounded-lg p-3 text-[12.5px] text-danger">{error}</div>}
        <div className="flex items-center justify-end gap-2 pt-2">
          <button onClick={closeModal} className="btn btn-ghost">Cancelar</button>
          <button onClick={confirm} className="btn btn-danger" disabled={busy}>
            {busy ? 'Revocando…' : 'Revocar acceso'}
          </button>
        </div>
      </div>
    </>
  )
}

function AdminRowMenu({ tenant, user, onChanged }) {
  const { openModal, toast } = useApp()
  const [open, setOpen]   = useState(false)

  async function resend() {
    setOpen(false)
    try {
      await api.post('/api/auth/forgot-password', {
        appId:    tenant.app_id,
        tenantId: tenant.id,
        email:    user.email,
      })
      toast(`Magic-link reenviado a ${user.email}`)
    } catch (err) {
      toast(err.message ?? 'No se pudo reenviar', 'danger')
    }
  }

  function changeRole() {
    setOpen(false)
    openModal(<ChangeRoleModal user={user} onDone={onChanged} />)
  }

  function revoke() {
    setOpen(false)
    openModal(<RevokeAdminModal tenant={tenant} user={user} onDone={onChanged} />)
  }

  return (
    <div className="relative inline-block">
      <button
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="text-ink3 hover:text-ink p-1"
        aria-label="Acciones"
      >{icons.more}</button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-10 min-w-[200px] bg-white border border-line rounded-lg shadow-pop py-1 text-[13px]">
          <button onMouseDown={changeRole}
            className="w-full text-left px-3 py-2 hover:bg-paper2">Cambiar rol</button>
          <button onMouseDown={resend}
            className="w-full text-left px-3 py-2 hover:bg-paper2">Reenviar magic-link</button>
          <div className="border-t border-line my-1" />
          <button onMouseDown={revoke}
            className="w-full text-left px-3 py-2 hover:bg-paper2 text-danger">Revocar acceso</button>
        </div>
      )}
    </div>
  )
}

function TabAdmins({ t, admins, onRefresh }) {
  const { openModal } = useApp()
  return (
    <div className="space-y-6">
      <div className="bg-white border border-line rounded-xl shadow-card">
        <div className="px-5 py-4 border-b border-line flex items-center justify-between">
          <div>
            <div className="font-display text-[20px]">Administradores</div>
            <div className="text-xs text-ink3 mt-0.5">{admins.length} personas con acceso al tenant</div>
          </div>
          <button
            onClick={() => openModal(<InviteAdminModal tenant={t} onDone={onRefresh} />)}
            className="btn btn-primary btn-sm"
          >
            {icons.plus}Invitar admin
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
                <td className="text-right">
                  <AdminRowMenu tenant={t} user={a} onChanged={onRefresh} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function TabSubscription({ t, onRefresh, onToast }) {
  const limit = t.plan === 'STARTER' ? 50000 : t.plan === 'PRO' ? 250000 : 2000000
  const pct   = Math.min(100, Math.round((t.volMonth / limit) * 100))
  return (
    <div className="space-y-6">
      <SubscriptionPanel tenant={t} onSaved={onRefresh} onToast={onToast} />

      <div className="bg-white border border-line rounded-xl shadow-card p-5">
        <div className="flex items-center justify-between mb-5">
          <div>
            <div className="font-display text-[20px]">Uso del plan</div>
            <div className="text-xs text-ink3 mt-0.5">Volumen procesado por la app del tenant (Stripe Connect, no el cobro de la plataforma)</div>
          </div>
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
    let cancelled = false
    setLoading(true)
    // Cargar el tenant primero — su app_id es necesario para listar users
    // con el scope correcto (antes usaba APP_ID='console' del propio
    // staff console, lo que devolvía 0 admins para tenants de cualquier
    // otra app como aikikan).
    api.get(`/api/tenants/tenants/${selectedTenant}`)
      .then(adaptTenant)
      .then(async (tenant) => {
        if (cancelled) return
        setTenant(tenant)
        const appId = tenant?.app_id
        const [adm, a, appRow] = await Promise.all([
          appId
            ? api.get(`/api/users/?appId=${encodeURIComponent(appId)}&tenantId=${selectedTenant}`)
                .then((l) => l.map(adaptUser)).catch(() => [])
            : Promise.resolve([]),
          api.get(`/api/audit/?tenantId=${selectedTenant}`)
            .then((l) => l.map((x) => adaptAudit(x))).catch(() => []),
          appId
            ? api.get(`/api/apps/${appId}`).catch(() => null)
            : Promise.resolve(null),
        ])
        if (cancelled) return
        setAdmins(adm)
        setAudit(a)
        setApp(appRow)
      })
      .catch(() => { if (!cancelled) setTenant(null) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [selectedTenant, refreshKey])

  const refresh = () => setRefreshKey((k) => k + 1)

  if (loading) return <div className="p-10 text-center text-ink3">Cargando…</div>
  if (!t) return <div className="p-10">Tenant no encontrado.</div>

  const color = tenantColor(t.id)

  const { toast } = useApp()

  function tabContent() {
    switch (tenantTab) {
      case 'identity':     return <TabIdentity t={t} />
      case 'state':        return <TabState t={t} />
      case 'stripe':       return <TabStripe t={t} app={app} />
      case 'admins':       return <TabAdmins t={t} admins={admins} onRefresh={refresh} />
      case 'subscription': return <TabSubscription t={t} onRefresh={refresh} onToast={toast} />
      case 'audit':        return <TabAudit t={t} log={audit} />
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
