import { useEffect, useState } from 'react'
import { useApp } from '../../../context/AppContext'
import { api } from '../../../lib/api'
import SecretInput from '../../../components/SecretInput'
import StripeModeSwitch from '../../../components/StripeModeSwitch'

// Stripe Connect config for platform/splitpay — TWO key sets (test/live), each
// with its own Connect platform account, plus the persisted active-mode switch
// (`stripe_mode`). Publishable keys and account ids are plain (they ship to
// browsers anyway); fee config is shared between modes.
export default function SplitpayConfig() {
  const { toast } = useApp()
  const [config, setConfig] = useState([])
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState('test')
  const [loadedMode, setLoadedMode] = useState('test')
  const [testAcct, setTestAcct] = useState('')
  const [testPub,  setTestPub]  = useState('')
  const [testSec,  setTestSec]  = useState('')
  const [testWh,   setTestWh]   = useState('')
  const [liveAcct, setLiveAcct] = useState('')
  const [livePub,  setLivePub]  = useState('')
  const [liveSec,  setLiveSec]  = useState('')
  const [liveWh,   setLiveWh]   = useState('')
  const [saving, setSaving] = useState(false)

  function reload() {
    setLoading(true)
    api.get('/api/splitpay/admin/config')
      .then((r) => {
        const data = r?.data ?? []
        setConfig(data)
        const val = (k) => data.find((c) => c.key === k)?.value ?? ''
        setTestAcct(val('platform_account_id_test'))
        setTestPub(val('stripe_test_publishable_key'))
        setLiveAcct(val('platform_account_id_live'))
        setLivePub(val('stripe_live_publishable_key'))
        const m = val('stripe_mode') === 'live' ? 'live' : 'test'
        setMode(m)
        setLoadedMode(m)
      })
      .catch((err) => toast(err.message, 'danger'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { reload() }, [])

  const cfgFor = (k) => config.find((c) => c.key === k) ?? {}

  async function save() {
    setSaving(true)
    try {
      const body = {}
      if (testAcct) body.platform_account_id_test = testAcct
      if (testPub)  body.stripe_test_publishable_key = testPub
      if (testSec)  body.stripe_test_secret_key = testSec
      if (testWh)   body.stripe_test_webhook_secret = testWh
      if (liveAcct) body.platform_account_id_live = liveAcct
      if (livePub)  body.stripe_live_publishable_key = livePub
      if (liveSec)  body.stripe_live_secret_key = liveSec
      if (liveWh)   body.stripe_live_webhook_secret = liveWh
      if (mode !== loadedMode) body.stripe_mode = mode
      if (Object.keys(body).length === 0) { toast('Nada que guardar', 'warning'); return }
      await api.patch('/api/splitpay/admin/config', body)
      toast(body.stripe_mode ? `Modo Stripe: ${mode}` : 'Split Pay configurado')
      setTestSec(''); setTestWh(''); setLiveSec(''); setLiveWh('')
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
      acct: testAcct, setAcct: setTestAcct, pub: testPub, setPub: setTestPub,
      sec: testSec, setSec: setTestSec, wh: testWh, setWh: setTestWh,
      keys: { sec: 'stripe_test_secret_key', wh: 'stripe_test_webhook_secret' },
      hints: { pub: 'pk_test_…', sec: 'sk_test_…' },
    },
    {
      m: 'live', title: 'Claves live',
      acct: liveAcct, setAcct: setLiveAcct, pub: livePub, setPub: setLivePub,
      sec: liveSec, setSec: setLiveSec, wh: liveWh, setWh: setLiveWh,
      keys: { sec: 'stripe_live_secret_key', wh: 'stripe_live_webhook_secret' },
      hints: { pub: 'pk_live_…', sec: 'sk_live_…' },
    },
  ]

  return (
    <div className="p-8 max-w-3xl fade-up">
      <div className="mb-8">
        <div className="text-[12px] uppercase tracking-[0.18em] text-ink3 mb-2">Configuración / Split Pay</div>
        <h1 className="font-display text-[44px] leading-none tracking-tight">
          <span className="italic font-normal">Stripe Connect</span>
        </h1>
        <p className="text-ink3 mt-3 max-w-2xl">
          Credenciales de la cuenta plataforma de Stripe Connect que reparte pagos a las cuentas de los vendedores,
          en dos juegos (test y live) con el modo activo conmutable.
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

            <div>
              <label className="block text-[12px] uppercase tracking-[0.14em] text-ink3 mb-1">Platform account ID (acct_…)</label>
              <input value={b.acct} onChange={(e) => b.setAcct(e.target.value)} placeholder="acct_1A2b3C4d…" className="input w-full font-mono text-[13px]" />
            </div>

            <div>
              <label className="block text-[12px] uppercase tracking-[0.14em] text-ink3 mb-1">Publishable key ({b.hints.pub})</label>
              <input value={b.pub} onChange={(e) => b.setPub(e.target.value)} placeholder={b.hints.pub} className="input w-full font-mono text-[13px]" />
            </div>

            <SecretInput label={`Secret key (${b.hints.sec})`}    configured={cfgFor(b.keys.sec).configured} value={b.sec} onChange={b.setSec} />
            <SecretInput label="Webhook secret (whsec_…)"         configured={cfgFor(b.keys.wh).configured}  value={b.wh}  onChange={b.setWh} />
          </div>
        ))}

        <div className="flex justify-end">
          <button onClick={save} disabled={saving} className="btn btn-primary">{saving ? 'Guardando…' : 'Guardar'}</button>
        </div>
      </div>
    </div>
  )
}
