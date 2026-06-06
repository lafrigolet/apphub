import { useEffect, useState } from 'react'
import { useApp } from '../../../context/AppContext'
import { api } from '../../../lib/api'
import SecretInput from '../../../components/SecretInput'
import StripeModeSwitch from '../../../components/StripeModeSwitch'

// Stripe config for platform/payments — TWO key sets (test/live) held at once
// plus the persisted active-mode switch (`stripe_mode`). Switching mode does
// not re-paste keys; it only flips which set the backend resolves.
export default function PaymentsConfig() {
  const { toast } = useApp()
  const [config, setConfig] = useState([])
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState('test')           // selected in the UI
  const [loadedMode, setLoadedMode] = useState('test') // persisted (badge "activo")
  const [testPub, setTestPub] = useState('')
  const [testSec, setTestSec] = useState('')
  const [testWh,  setTestWh]  = useState('')
  const [livePub, setLivePub] = useState('')
  const [liveSec, setLiveSec] = useState('')
  const [liveWh,  setLiveWh]  = useState('')
  const [saving, setSaving] = useState(false)

  function reload() {
    setLoading(true)
    api.get('/api/payments/admin/config')
      .then((r) => {
        const data = r?.data ?? []
        setConfig(data)
        const m = data.find((c) => c.key === 'stripe_mode')?.value === 'live' ? 'live' : 'test'
        setMode(m)
        setLoadedMode(m)
      })
      .catch((err) => toast(err.message ?? 'Error cargando config', 'danger'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { reload() }, [])

  const cfgFor = (k) => config.find((c) => c.key === k) ?? { configured: false }

  async function save() {
    setSaving(true)
    try {
      const body = {}
      if (testPub) body.stripe_test_publishable_key = testPub
      if (testSec) body.stripe_test_secret_key = testSec
      if (testWh)  body.stripe_test_webhook_secret = testWh
      if (livePub) body.stripe_live_publishable_key = livePub
      if (liveSec) body.stripe_live_secret_key = liveSec
      if (liveWh)  body.stripe_live_webhook_secret = liveWh
      if (mode !== loadedMode) body.stripe_mode = mode
      if (Object.keys(body).length === 0) { toast('Nada que guardar', 'warning'); return }
      await api.patch('/api/payments/admin/config', body)
      toast(body.stripe_mode ? `Modo Stripe: ${mode}` : 'Stripe configurado')
      setTestPub(''); setTestSec(''); setTestWh('')
      setLivePub(''); setLiveSec(''); setLiveWh('')
      reload()
    } catch (err) {
      toast(err.message ?? 'Error guardando', 'danger')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="p-10 text-center text-ink3">Cargando…</div>

  const blocks = [
    {
      m: 'test', title: 'Claves test',
      pub: testPub, setPub: setTestPub, sec: testSec, setSec: setTestSec, wh: testWh, setWh: setTestWh,
      keys: { pub: 'stripe_test_publishable_key', sec: 'stripe_test_secret_key', wh: 'stripe_test_webhook_secret' },
      hints: { pub: 'pk_test_…', sec: 'sk_test_…' },
    },
    {
      m: 'live', title: 'Claves live',
      pub: livePub, setPub: setLivePub, sec: liveSec, setSec: setLiveSec, wh: liveWh, setWh: setLiveWh,
      keys: { pub: 'stripe_live_publishable_key', sec: 'stripe_live_secret_key', wh: 'stripe_live_webhook_secret' },
      hints: { pub: 'pk_live_…', sec: 'sk_live_…' },
    },
  ]

  return (
    <div className="p-8 max-w-3xl fade-up">
      <div className="mb-8">
        <div className="text-[12px] uppercase tracking-[0.18em] text-ink3 mb-2">Configuración / Payments</div>
        <h1 className="font-display text-[44px] leading-none tracking-tight">
          <span className="italic font-normal">Stripe</span>
        </h1>
        <p className="text-ink3 mt-3 max-w-2xl">
          Credenciales de Stripe del módulo <code className="font-mono text-ink">platform/payments</code>, en dos juegos
          (test y live) con el modo activo conmutable. Encuentra estos valores en{' '}
          <a className="link" href="https://dashboard.stripe.com/apikeys" target="_blank" rel="noreferrer">dashboard.stripe.com/apikeys</a> y{' '}
          <a className="link" href="https://dashboard.stripe.com/webhooks" target="_blank" rel="noreferrer">webhooks</a>.
        </p>
      </div>

      <div className="space-y-6">
        <div className="card p-6">
          <StripeModeSwitch mode={mode} loadedMode={loadedMode} onChange={setMode} />
        </div>

        {blocks.map((b) => (
          <div key={b.m} className={`card p-6 space-y-5 ${loadedMode === b.m ? 'border-ink' : ''}`}>
            <div className="flex items-center justify-between">
              <h2 className="text-[15px] font-medium">{b.title}</h2>
              {loadedMode === b.m && (
                <span className="text-[10px] uppercase tracking-wider px-2 py-1 rounded bg-ink text-paper">activo</span>
              )}
            </div>
            <SecretInput label={`Publishable key (${b.hints.pub})`} configured={cfgFor(b.keys.pub).configured} value={b.pub} onChange={b.setPub} />
            <SecretInput label={`Secret key (${b.hints.sec})`}      configured={cfgFor(b.keys.sec).configured} value={b.sec} onChange={b.setSec} />
            <SecretInput label="Webhook signing secret (whsec_…)"   configured={cfgFor(b.keys.wh).configured}  value={b.wh}  onChange={b.setWh} />
          </div>
        ))}

        <div className="flex justify-end">
          <button onClick={save} disabled={saving} className="btn btn-primary">{saving ? 'Guardando…' : 'Guardar'}</button>
        </div>
      </div>
    </div>
  )
}
