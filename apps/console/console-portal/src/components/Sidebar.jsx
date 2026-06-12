import { useEffect, useState } from 'react'
import { useApp } from '../context/AppContext'
import { api } from '../lib/api'
import { icons } from '../lib/icons'

export default function Sidebar() {
  const { role, view, navigate, myTenant } = useApp()
  const t = myTenant

  // Load the caller's app to know which optional sections (e.g. Splitpay) appear.
  const [myApp, setMyApp] = useState(null)
  useEffect(() => {
    if (role === 'staff' || !myTenant?.app_id) { setMyApp(null); return }
    api.get(`/api/apps/${myTenant.app_id}`).then(setMyApp).catch(() => setMyApp(null))
  }, [role, myTenant])

  const staffItems = [
    { k: 'dashboard', label: 'Dashboard', icon: icons.dashboard },
    { k: 'apps',      label: 'Apps',      icon: icons.apps },
    { k: 'tenants',    label: 'Tenants',    icon: icons.tenants },
    { k: 'onboarding', label: 'Onboarding', icon: icons.tenants },
    { k: 'staff',      label: 'Staff',      icon: icons.staff },
    { k: 'audit',     label: 'Audit log', icon: icons.audit },
    { _section: 'Configuración' },
    { k: 'config-auth',                      label: 'OAuth Providers', icon: icons.settings },
    { k: 'config-payments',                  label: 'Stripe',          icon: icons.settings },
    { k: 'config-notifications',             label: 'Resend',          icon: icons.settings },
    { k: 'config-twilio',                    label: 'Twilio (SMS)',    icon: icons.settings },
    { k: 'config-push',                      label: 'Push (FCM)',      icon: icons.settings },
    { k: 'config-notifications-templates',   label: 'Plantillas',      icon: icons.settings },
    { k: 'config-splitpay',                  label: 'Split Pay',       icon: icons.settings },
    { k: 'config-storage',                   label: 'Object storage',  icon: icons.settings },
    { k: 'config-delivery-dispatch',         label: 'Delivery carriers', icon: icons.settings },
    { k: 'config-telehealth',                label: 'Telehealth video',  icon: icons.settings },
    { k: 'config-shipping',                  label: 'Shipping carriers', icon: icons.settings },
    { k: 'config-tpv',                       label: 'TPV / Caja',        icon: icons.settings },
    { k: 'config-verifactu',                 label: 'Veri*Factu (SIF)',  icon: icons.settings },
  ]

  const splitpayItem = myApp?.splitpay_enabled
    ? [{ k: 'splitpay', label: 'Split Pay', icon: icons.tag }]
    : []

  const ownerItems = [
    { k: 'overview',  label: 'Resumen',          icon: icons.dashboard },
    { k: 'admins',    label: 'Administradores',  icon: icons.admins },
    { k: 'settings',  label: 'Ajustes',          icon: icons.settings },
    { k: 'email',     label: 'Email',            icon: icons.settings },
    ...splitpayItem,
    { k: 'audit',     label: 'Audit log',        icon: icons.audit },
    { k: 'danger',    label: 'Zona peligrosa',   icon: icons.danger, accent: true },
  ]

  const adminItems = [
    { k: 'overview',  label: 'Resumen',          icon: icons.dashboard },
    { k: 'admins',    label: 'Administradores',  icon: icons.admins },
    { k: 'settings',  label: 'Ajustes',          icon: icons.settings },
    { k: 'email',     label: 'Email',            icon: icons.settings },
    ...splitpayItem,
    { k: 'audit',     label: 'Audit log',        icon: icons.audit },
  ]

  const items = role === 'staff' ? staffItems : role === 'owner' ? ownerItems : adminItems
  const sectionLabel = role === 'staff' ? 'Plataforma' : t?.display_name || ''

  return (
    <aside className="w-60 shrink-0 border-r border-line min-h-[calc(100vh-56px)] bg-paper sticky top-14 self-start h-[calc(100vh-56px)] overflow-y-auto">
      <nav className="p-3">
        <div className="px-3 pt-2 pb-3 text-[10px] uppercase tracking-[0.18em] text-ink3">
          {sectionLabel}
        </div>
        {items.map((it, idx) => {
          if (it._section) {
            return (
              <div key={`sec-${idx}`} className="px-4 pt-5 pb-2 text-[10px] uppercase tracking-[0.18em] text-ink3 border-t border-line mt-3">
                {it._section}
              </div>
            )
          }
          // The template editor is a sub-route of Plantillas — highlight the
          // parent item when the editor is open so the sidebar remains
          // navigable from edit screens.
          const isTemplateEditor = view === 'config-notifications-template-edit' && it.k === 'config-notifications-templates'
          const active = view === it.k || isTemplateEditor
          return (
            <button
              key={it.k}
              onClick={() => navigate(it.k)}
              className={`nav-link w-full text-left flex items-center gap-3 px-4 py-2 rounded-lg text-[13.5px] text-ink2 ${active ? 'active' : ''} ${it.accent ? 'text-danger' : ''}`}
            >
              <span className={active ? 'text-ink' : 'text-ink3'}>{it.icon}</span>
              <span>{it.label}</span>
            </button>
          )
        })}
      </nav>

      <div className="mt-4 px-5 py-4 border-t border-line">
        <div className="text-[10px] uppercase tracking-[0.18em] text-ink3 mb-2">Dev</div>
        <div className="text-[12px] leading-relaxed text-ink3">
          Conectado a <span className="text-ink">{import.meta.env.VITE_API_BASE_URL || '/api'}</span>.
        </div>
      </div>
    </aside>
  )
}
