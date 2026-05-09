import { useEffect, useState } from 'react'
import { useApp } from '../../context/AppContext'
import { api } from '../../lib/api'
import { icons } from '../../lib/icons'
import { EmptyState } from '../../lib/ui'
import BootstrapTenantModal from './modals/BootstrapTenantModal'

function daysSince(iso) {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  const d = Math.floor(ms / (24 * 60 * 60 * 1000))
  if (d === 0) return 'hoy'
  if (d === 1) return 'ayer'
  return `hace ${d} días`
}

export default function StaffOnboarding() {
  const { openModal, toast } = useApp()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState({}) // { [tenantId]: 'resend' | 'revoke' }

  function load() {
    setLoading(true)
    api.get('/api/tenants/tenants/onboarding')
      .then((res) => setItems(res?.data ?? res ?? []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  async function resend(t) {
    setBusy(b => ({ ...b, [t.id]: 'resend' }))
    try {
      const res = await api.post(`/api/tenants/tenants/${t.id}/resend-activation`)
      const url = res?.data?.magicLinkUrl ?? res?.magicLinkUrl
      // Mostramos el nuevo link en el toast — staff lo puede copiar si el email no llega.
      toast(`Magic-link reemitido. ${url ? 'URL copiada al portapapeles.' : ''}`)
      if (url && navigator.clipboard) {
        try { await navigator.clipboard.writeText(url) } catch { /* permissions */ }
      }
    } catch (err) {
      toast(err.message ?? 'Error al reenviar', 'danger')
    } finally {
      setBusy(b => { const n = { ...b }; delete n[t.id]; return n })
    }
  }

  async function revoke(t) {
    if (!confirm(`Revocar el tenant "${t.display_name}"? Esto borra el tenant + owner + tokens. Sólo permitido mientras el owner no haya activado.`)) return
    setBusy(b => ({ ...b, [t.id]: 'revoke' }))
    try {
      await api.delete(`/api/tenants/tenants/${t.id}/bootstrap`)
      toast(`Tenant "${t.display_name}" revocado`)
      setItems(arr => arr.filter(x => x.id !== t.id))
    } catch (err) {
      toast(err.message ?? 'Error al revocar', 'danger')
    } finally {
      setBusy(b => { const n = { ...b }; delete n[t.id]; return n })
    }
  }

  if (loading) return <div className="p-10 text-center text-ink3">Cargando…</div>

  return (
    <div className="p-8 max-w-7xl fade-up">
      <div className="flex items-start justify-between gap-6 mb-8">
        <div>
          <div className="text-[12px] uppercase tracking-[0.18em] text-ink3 mb-2">Plataforma</div>
          <h1 className="font-display text-[44px] leading-none tracking-tight">
            <span className="italic font-normal">Tenants en onboarding</span>
          </h1>
          <p className="text-ink3 mt-3 max-w-xl">
            {items.length} pendiente{items.length === 1 ? '' : 's'} de activar.
            La cuenta del owner no funciona hasta que consume el magic-link.
          </p>
        </div>
        <button
          onClick={() => openModal(<BootstrapTenantModal onCreated={() => load()} />, { size: 'xl' })}
          className="btn btn-primary shrink-0"
        >
          {icons.plus}<span>Bootstrap nuevo tenant</span>
        </button>
      </div>

      <div className="bg-white border border-line rounded-xl shadow-card overflow-hidden">
        <table className="t">
          <thead>
            <tr>
              <th>Tenant</th>
              <th>App</th>
              <th>Subdomain</th>
              <th>Email contacto</th>
              <th>Iniciado</th>
              <th className="text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0
              ? <EmptyState cols={6} msg="No hay tenants en onboarding pendiente." />
              : items.map(t => (
                <tr key={t.id}>
                  <td className="font-medium">{t.display_name}</td>
                  <td><span className="font-mono text-[12px] text-ink2">{t.app_id}</span></td>
                  <td><span className="font-mono text-[12px]">{t.subdomain}</span></td>
                  <td className="text-[13px]">{t.contact_email ?? '—'}</td>
                  <td className="text-[13px] text-ink3">{daysSince(t.bootstrap_started_at)}</td>
                  <td className="text-right">
                    <div className="inline-flex gap-2">
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => resend(t)}
                        disabled={busy[t.id] === 'resend'}
                      >
                        {busy[t.id] === 'resend' ? 'Enviando…' : 'Reenviar'}
                      </button>
                      <button
                        className="btn btn-ghost btn-sm text-danger"
                        onClick={() => revoke(t)}
                        disabled={busy[t.id] === 'revoke'}
                      >
                        {busy[t.id] === 'revoke' ? 'Revocando…' : 'Revocar'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            }
          </tbody>
        </table>
      </div>
    </div>
  )
}
