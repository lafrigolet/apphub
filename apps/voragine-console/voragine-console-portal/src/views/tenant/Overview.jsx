import { useApp } from '../../context/AppContext'
import { ADMINS_BY_TENANT } from '../../data/mock'
import { fmtMoney, fmtNumber } from '../../lib/utils'
import { icons } from '../../lib/icons'
import { StatusBadge, StripeBadge, PlanBadge, Kpi, Checklist } from '../../lib/ui'
import { ExportModal } from '../staff/modals/TenantActionModals'
import TransferModal from './modals/TransferModal'

export default function TenantOverview() {
  const { navigate, openModal, currentTenant, role } = useApp()
  const t = currentTenant()

  return (
    <div className="p-8 max-w-6xl fade-up">
      <div className="flex items-start justify-between gap-6 mb-8">
        <div>
          <div className="text-[12px] uppercase tracking-[0.18em] text-ink3 mb-2">Mi tenant</div>
          <h1 className="font-display text-[44px] leading-none tracking-tight">{t.name}</h1>
          <p className="text-ink3 mt-3 max-w-xl">Resumen de la actividad y configuración de tu tenant en Voragine.</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={t.status} />
          <PlanBadge plan={t.plan} />
          <StripeBadge status={t.stripe} />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <Kpi label="Volumen mes"      value={fmtMoney(t.volMonth)} hint="Procesado este periodo" />
        <Kpi label="Transacciones"    value={fmtNumber(t.txMonth)} hint="Última factura: 1 may" />
        <Kpi label="Administradores"  value={String((ADMINS_BY_TENANT[t.id] || []).length || 3)} hint="2FA recomendado para todos" />
        <Kpi label="KYC Stripe"       value={t.stripe === 'VERIFIED' ? 'OK' : 'Pendiente'} hint="Revisar requirements" tone={t.stripe === 'VERIFIED' ? 'ok' : 'ink'} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white border border-line rounded-xl shadow-card">
          <div className="px-5 py-4 border-b border-line flex items-center justify-between">
            <div className="font-display text-[20px]">Checklist de onboarding</div>
            <span className="text-[12px] text-ink3">4 de 5 completados</span>
          </div>
          <div className="divide-y divide-line">
            <Checklist label="Cuenta Stripe Connect vinculada"  done={true} />
            <Checklist label="Dominio propio configurado"       done={!!t.customDomain} />
            <Checklist label="Al menos 1 admin invitado"        done={true} />
            <Checklist label="Primera transacción de prueba"    done={true} />
            <Checklist label="Webhook saliente configurado"     done={false} />
          </div>
        </div>

        <div className="bg-white border border-line rounded-xl shadow-card">
          <div className="px-5 py-4 border-b border-line">
            <div className="font-display text-[20px]">Acciones rápidas</div>
          </div>
          <div className="p-5 space-y-2">
            <button onClick={() => navigate('admins')} className="btn btn-ghost w-full justify-start">
              {icons.admins}<span>Gestionar administradores</span>
            </button>
            <button onClick={() => navigate('settings')} className="btn btn-ghost w-full justify-start">
              {icons.settings}<span>Editar datos del tenant</span>
            </button>
            {role === 'owner' && (
              <button onClick={() => openModal(<TransferModal />)} className="btn btn-ghost w-full justify-start">
                {icons.transfer}<span>Transferir propiedad</span>
              </button>
            )}
            <button onClick={() => openModal(<ExportModal />)} className="btn btn-ghost w-full justify-start">
              {icons.download}<span>Exportar mis datos</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
