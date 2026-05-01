import { AppProvider, useApp } from './context/AppContext'
import Topbar from './components/Topbar'
import Sidebar from './components/Sidebar'
import ToastContainer from './components/Toast'
import ModalContainer from './components/Modal'
import LoginView from './views/auth/LoginView'

import StaffDashboard  from './views/staff/Dashboard'
import StaffApps       from './views/staff/Apps'
import StaffTenants    from './views/staff/Tenants'
import TenantDetail    from './views/staff/TenantDetail'
import StaffList       from './views/staff/StaffList'
import AuditGlobal     from './views/staff/AuditGlobal'

import AuthProviders               from './views/staff/config/AuthProviders'
import PaymentsConfig              from './views/staff/config/PaymentsConfig'
import NotificationsConfig         from './views/staff/config/NotificationsConfig'
import TwilioConfig                from './views/staff/config/TwilioConfig'
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
    if (view === 'staff')                                  return <StaffList />
    if (view === 'audit')                                  return <AuditGlobal />
    if (view === 'config-auth')                            return <AuthProviders />
    if (view === 'config-payments')                        return <PaymentsConfig />
    if (view === 'config-notifications')                   return <NotificationsConfig />
    if (view === 'config-twilio')                          return <TwilioConfig />
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

function Shell() {
  const { identity, onLogin } = useApp()
  if (!identity) return <LoginView onSuccess={onLogin} />
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
