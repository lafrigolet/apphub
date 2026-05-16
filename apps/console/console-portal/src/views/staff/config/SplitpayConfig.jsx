import { useEffect, useState } from 'react'
import { useApp } from '../../../context/AppContext'
import { api } from '../../../lib/api'
import SecretInput from '../../../components/SecretInput'

export default function SplitpayConfig() {
  const { toast } = useApp()
  const [config, setConfig] = useState([])
  const [loading, setLoading] = useState(true)
  const [acctId, setAcctId] = useState('')
  const [pubKey, setPubKey] = useState('')
  const [secKey, setSecKey] = useState('')
  const [whSec, setWhSec] = useState('')
  const [saving, setSaving] = useState(false)

  function reload() {
    setLoading(true)
    api.get('/api/splitpay/admin/config')
      .then((r) => {
        const data = r?.data ?? []
        setConfig(data)
        setAcctId(data.find((c) => c.key === 'platform_account_id')?.value ?? '')
        setPubKey(data.find((c) => c.key === 'stripe_publishable_key')?.value ?? '')
      })
      .catch((err) => toast(err.message, 'danger'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { reload() }, [])

  const cfgFor = (k) => config.find((c) => c.key === k) ?? {}

  async function save() {
    setSaving(true)
    try {
      const body = { platform_account_id: acctId || null, stripe_publishable_key: pubKey || null }
      if (secKey) body.stripe_secret_key = secKey
      if (whSec)  body.stripe_webhook_secret = whSec
      await api.patch('/api/splitpay/admin/config', body)
      toast('Split Pay configurado')
      setSecKey(''); setWhSec('')
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
        <div className="text-[12px] uppercase tracking-[0.18em] text-ink3 mb-2">Configuración / Split Pay</div>
        <h1 className="font-display text-[44px] leading-none tracking-tight">
          <span className="italic font-normal">Stripe Connect</span>
        </h1>
        <p className="text-ink3 mt-3 max-w-2xl">
          Credenciales de la cuenta plataforma de Stripe Connect que reparte pagos a las cuentas de los vendedores.
        </p>
      </div>

      <div className="card p-6 space-y-5">
        <div>
          <label className="block text-[12px] uppercase tracking-[0.14em] text-ink3 mb-1">Platform account ID (acct_…)</label>
          <input value={acctId} onChange={(e) => setAcctId(e.target.value)} placeholder="acct_1A2b3C4d…" className="input w-full font-mono text-[13px]" />
        </div>

        <div>
          <label className="block text-[12px] uppercase tracking-[0.14em] text-ink3 mb-1">Publishable key (pk_…)</label>
          <input value={pubKey} onChange={(e) => setPubKey(e.target.value)} placeholder="pk_test_…" className="input w-full font-mono text-[13px]" />
        </div>

        <SecretInput label="Secret key (sk_…)"          configured={cfgFor('stripe_secret_key').configured}     value={secKey} onChange={setSecKey} />
        <SecretInput label="Webhook secret (whsec_…)"   configured={cfgFor('stripe_webhook_secret').configured} value={whSec}  onChange={setWhSec} />

        <div className="flex justify-end">
          <button onClick={save} disabled={saving} className="btn btn-primary">{saving ? 'Guardando…' : 'Guardar'}</button>
        </div>
      </div>
    </div>
  )
}
