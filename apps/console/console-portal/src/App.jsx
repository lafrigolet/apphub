import { AppProvider, useApp } from './context/AppContext'
import Topbar from './components/Topbar'
import Sidebar from './components/Sidebar'
import ToastContainer from './components/Toast'
import ModalContainer from './components/Modal'
import LoginView from './views/auth/LoginView'
import MagicLoginView from './views/auth/MagicLoginView'

import StaffDashboard  from './views/staff/Dashboard'
import StaffApps       from './views/staff/Apps'
import StaffTenants    from './views/staff/Tenants'
import StaffOnboarding from './views/staff/Onboarding'
import TenantDetail    from './views/staff/TenantDetail'
import StaffList       from './views/staff/StaffList'
import AuditGlobal     from './views/staff/AuditGlobal'

import AuthProviders               from './views/staff/config/AuthProviders'
import PaymentsConfig              from './views/staff/config/PaymentsConfig'
import NotificationsConfig         from './views/staff/config/NotificationsConfig'
import TwilioConfig                from './views/staff/config/TwilioConfig'
import PushConfig                  from './views/staff/config/PushConfig'
import NotificationsTemplates      from './views/staff/config/NotificationsTemplates'
import NotificationsTemplateEdit   from './views/staff/config/NotificationsTemplateEdit'
import SplitpayConfig              from './views/staff/config/SplitpayConfig'
import StorageConfig               from './views/staff/config/StorageConfig'
import DeliveryDispatchConfig      from './views/staff/config/DeliveryDispatchConfig'
import TelehealthConfig            from './views/staff/config/TelehealthConfig'
import ShippingConfig              from './views/staff/config/ShippingConfig'

import TenantOverview  from './views/tenant/Overview'
import TenantAdmins    from './views/tenant/Admins'
import TenantSettings  from './views/tenant/Settings'
import TenantEmail     from './views/tenant/Email'
import TenantSplitpay  from './views/tenant/Splitpay'
import TenantAudit     from './views/tenant/Audit'
import TenantDanger    from './views/tenant/Danger'

function MainContent() {
  const { role, view, selectedTenant } = useApp()

  if (role === 'staff') {
    if (view === 'dashboard')                              return <StaffDashboard />
    if (view === 'apps')                                   return <StaffApps />
    if (view === 'tenants' && selectedTenant)              return <TenantDetail />
    if (view === 'tenants')                                return <StaffTenants />
    if (view === 'onboarding')                             return <StaffOnboarding />
    if (view === 'staff')                                  return <StaffList />
    if (view === 'audit')                                  return <AuditGlobal />
    if (view === 'config-auth')                            return <AuthProviders />
    if (view === 'config-payments')                        return <PaymentsConfig />
    if (view === 'config-notifications')                   return <NotificationsConfig />
    if (view === 'config-twilio')                          return <TwilioConfig />
    if (view === 'config-push')                            return <PushConfig />
    if (view === 'config-notifications-templates')         return <NotificationsTemplates />
    if (view === 'config-notifications-template-edit')     return <NotificationsTemplateEdit />
    if (view === 'config-splitpay')                        return <SplitpayConfig />
    if (view === 'config-storage')                         return <StorageConfig />
    if (view === 'config-delivery-dispatch')               return <DeliveryDispatchConfig />
    if (view === 'config-telehealth')                      return <TelehealthConfig />
    if (view === 'config-shipping')                        return <ShippingConfig />
  } else {
    if (view === 'overview')  return <TenantOverview />
    if (view === 'admins')    return <TenantAdmins />
    if (view === 'settings')  return <TenantSettings />
    if (view === 'email')     return <TenantEmail />
    if (view === 'splitpay')  return <TenantSplitpay />
    if (view === 'audit')     return <TenantAudit />
    if (view === 'danger')    return <TenantDanger />
  }
  return <div className="p-10 text-ink3">Vista no encontrada.</div>
}

// Cutover (tenant-console Fase 4): console serves only the staff
// role. A user that signs in with role owner/admin/user belongs in their
// own tenant-console at <tenant.subdomain>.<host-suffix>; we surface a
// soft handoff with a one-click redirect rather than a hard window.replace
// so the user can copy the URL or back-navigate if needed.
function TenantHandoff({ tenant, onLogout }) {
  if (!tenant?.subdomain) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-paper">
        <div className="max-w-md bg-white border border-line rounded-2xl shadow-card p-8">
          <h1 className="font-display text-[24px] mb-3">Acceso solo staff</h1>
          <p className="text-[13.5px] text-ink2">Tu cuenta no tiene rol staff y tu tenant no tiene subdominio configurado. Avisa al equipo de plataforma.</p>
          <button onClick={onLogout} className="mt-5 btn btn-ghost">Cerrar sesión</button>
        </div>
      </main>
    )
  }
  const suffix = window.location.hostname.split('.').slice(1).join('.')
  const port   = window.location.port ? ':' + window.location.port : ''
  const target = `${window.location.protocol}//${tenant.subdomain}.${suffix}${port}/`
  return (
    <main className="min-h-screen flex items-center justify-center bg-paper">
      <div className="max-w-md bg-white border border-line rounded-2xl shadow-card p-8">
        <div className="text-[12px] uppercase tracking-[0.18em] text-ink3 mb-2">Tu console</div>
        <h1 className="font-display text-[24px] mb-3">{tenant.display_name}</h1>
        <p className="text-[13.5px] text-ink2 mb-5">
          Hulkstein Console es solo para staff de plataforma. Tu console del tenant está en
          <a href={target} className="font-mono mx-1 underline">{tenant.subdomain}.{suffix}</a>.
        </p>
        <div className="flex items-center gap-3">
          <a href={target} className="btn btn-primary">Ir a mi console</a>
          <button onClick={onLogout} className="btn btn-ghost">Cerrar sesión</button>
        </div>
      </div>
    </main>
  )
}

function Shell() {
  const { identity, onLogin, role, myTenant, logout } = useApp()
  // Magic-link callback: when the user opens the email link the URL lands on
  // /magic-login?token=… — MagicLoginView redeems the token and then calls
  // onLogin to flip AppContext. We route on pathname rather than pulling in
  // react-router; one extra route doesn't justify the dep.
  if (window.location.pathname === '/magic-login') return <MagicLoginView onSuccess={onLogin} />
  if (!identity) return <LoginView />
  if (role !== 'staff') return <TenantHandoff tenant={myTenant} onLogout={logout} />
  return (
    <div className="min-h-screen flex flex-col">
      <Topbar />
      <div className="flex-1 flex">
        <Sidebar />
        <main className="flex-1 min-w-0">
          <MainContent />
        </main>
      </div>
      <ToastContainer />
      <ModalContainer />
    </div>
  )
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  )
}
