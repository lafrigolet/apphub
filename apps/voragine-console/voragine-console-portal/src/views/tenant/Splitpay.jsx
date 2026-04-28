import { useEffect, useState } from 'react'
import { useApp } from '../../context/AppContext'
import { api } from '../../lib/api'
import { SplitpayConfigTabs } from '../staff/SplitpayPanels'

export default function TenantSplitpay() {
  const { myTenant, toast } = useApp()
  const [app, setApp]               = useState(null)
  const [appLoading, setAppLoading] = useState(true)

  useEffect(() => {
    if (!myTenant?.app_id) return
    setAppLoading(true)
    api.get(`/api/apps/${myTenant.app_id}`)
      .then(setApp)
      .catch(() => setApp(null))
      .finally(() => setAppLoading(false))
  }, [myTenant])

  if (appLoading || !myTenant) return <div className="p-10 text-center text-ink3">Cargando…</div>

  if (!app?.splitpay_enabled) {
    return (
      <div className="p-8 max-w-3xl fade-up">
        <h1 className="font-display text-[36px] tracking-tight mb-3">
          <span className="italic font-normal">Split Pay</span>
        </h1>
        <div className="bg-paper2 border border-line rounded-xl p-6">
          <div className="font-medium mb-1">Split Pay no está habilitado para esta app</div>
          <div className="text-[13px] text-ink3">
            Contacta con el equipo de plataforma (Voragine staff) para activar la funcionalidad de Stripe Connect en{' '}
            <span className="font-mono">{myTenant.app_id}</span>.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-8 max-w-5xl fade-up">
      <div className="mb-6">
        <div className="text-[12px] uppercase tracking-[0.18em] text-ink3 mb-2">{myTenant.display_name}</div>
        <h1 className="font-display text-[44px] leading-none tracking-tight">
          <span className="italic font-normal">Split Pay</span>
        </h1>
        <p className="text-ink3 mt-3 max-w-2xl">
          Configura tu cuenta de Stripe Connect y las reglas de reparto que aplican a los pagos de este tenant.
        </p>
      </div>

      {/* No scopeQuery: backend uses the JWT's tenant for owner/admin */}
      <SplitpayConfigTabs onToast={toast} />
    </div>
  )
}
