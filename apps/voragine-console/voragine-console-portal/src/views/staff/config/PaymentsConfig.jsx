import { useEffect, useState } from 'react'
import { useApp } from '../../../context/AppContext'
import { api } from '../../../lib/api'
import SecretInput from '../../../components/SecretInput'

export default function PaymentsConfig() {
  const { toast } = useApp()
  const [config, setConfig] = useState([])
  const [loading, setLoading] = useState(true)
  const [pubKey, setPubKey] = useState('')
  const [secKey, setSecKey] = useState('')
  const [whSec,  setWhSec]  = useState('')
  const [saving, setSaving] = useState(false)

  function reload() {
    setLoading(true)
    api.get('/api/payments/admin/config')
      .then((r) => setConfig(r?.data ?? []))
      .catch((err) => toast(err.message ?? 'Error cargando config', 'danger'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { reload() }, [])

  const cfgFor = (k) => config.find((c) => c.key === k) ?? { configured: false }

  async function save() {
    setSaving(true)
    try {
      const body = {}
      if (pubKey) body.stripe_publishable_key = pubKey
      if (secKey) body.stripe_secret_key = secKey
      if (whSec)  body.stripe_webhook_secret = whSec
      if (Object.keys(body).length === 0) { toast('Nada que guardar', 'warning'); return }
      await api.patch('/api/payments/admin/config', body)
      toast('Stripe configurado')
      setPubKey(''); setSecKey(''); setWhSec('')
      reload()
    } catch (err) {
      toast(err.message ?? 'Error guardando', 'danger')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="p-10 text-center text-ink3">Cargando…</div>

  return (
    <div className="p-8 max-w-3xl fade-up">
      <div className="mb-8">
        <div className="text-[12px] uppercase tracking-[0.18em] text-ink3 mb-2">Configuración / Payments</div>
        <h1 className="font-display text-[44px] leading-none tracking-tight">
          <span className="italic font-normal">Stripe</span>
        </h1>
        <p className="text-ink3 mt-3 max-w-2xl">
          Credenciales de Stripe del módulo <code className="font-mono text-ink">platform/payments</code>. Encuentra estos valores en{' '}
          <a className="link" href="https://dashboard.stripe.com/apikeys" target="_blank" rel="noreferrer">dashboard.stripe.com/apikeys</a> y{' '}
          <a className="link" href="https://dashboard.stripe.com/webhooks" target="_blank" rel="noreferrer">webhooks</a>.
        </p>
      </div>

      <div className="card p-6 space-y-5">
        <SecretInput label="Publishable key (pk_live_… / pk_test_…)" configured={cfgFor('stripe_publishable_key').configured} value={pubKey} onChange={setPubKey} />
        <SecretInput label="Secret key (sk_live_… / sk_test_…)"        configured={cfgFor('stripe_secret_key').configured}      value={secKey} onChange={setSecKey} />
        <SecretInput label="Webhook signing secret (whsec_…)"           configured={cfgFor('stripe_webhook_secret').configured}  value={whSec}  onChange={setWhSec} />

        <div className="flex justify-end">
          <button onClick={save} disabled={saving} className="btn btn-primary">{saving ? 'Guardando…' : 'Guardar'}</button>
        </div>
      </div>
    </div>
  )
}
