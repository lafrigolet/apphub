import { useEffect, useState } from 'react'
import { useApp } from '../../../context/AppContext'
import { api } from '../../../lib/api'
import SecretInput from '../../../components/SecretInput'

const PROVIDERS = [
  {
    id: 'ups',
    name: 'UPS',
    docs: 'https://developer.ups.com/',
    plain: [
      { key: 'ups_account_number', label: 'Account Number' },
    ],
    secrets: [
      { key: 'ups_client_id',     label: 'Client ID' },
      { key: 'ups_client_secret', label: 'Client Secret' },
    ],
  },
  {
    id: 'fedex',
    name: 'FedEx',
    docs: 'https://developer.fedex.com/',
    plain: [
      { key: 'fedex_account_number', label: 'Account Number' },
      { key: 'fedex_meter_number',   label: 'Meter Number' },
    ],
    secrets: [
      { key: 'fedex_api_key',    label: 'API Key' },
      { key: 'fedex_secret_key', label: 'Secret Key' },
    ],
  },
  {
    id: 'dhl',
    name: 'DHL Express',
    docs: 'https://developer.dhl.com/',
    plain: [
      { key: 'dhl_account_number', label: 'Account Number' },
    ],
    secrets: [
      { key: 'dhl_api_key',    label: 'API Key' },
      { key: 'dhl_api_secret', label: 'API Secret' },
    ],
  },
  {
    id: 'easypost',
    name: 'EasyPost (multi-carrier)',
    docs: 'https://docs.easypost.com/',
    plain: [],
    secrets: [
      { key: 'easypost_api_key',        label: 'API Key' },
      { key: 'easypost_webhook_secret', label: 'Webhook Secret' },
    ],
  },
]

export default function ShippingConfig() {
  const { toast } = useApp()
  const [config, setConfig] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({})

  function reload() {
    setLoading(true)
    api.get('/api/shipping/admin/config')
      .then((r) => {
        const data = r?.data ?? []
        setConfig(data)
        const next = {}
        for (const p of PROVIDERS) {
          next[`${p.id}_enabled`]     = pickPlain(data, `${p.id}_enabled`) === 'true'
          next[`${p.id}_environment`] = pickPlain(data, `${p.id}_environment`) || 'sandbox'
          for (const f of p.plain) next[f.key] = pickPlain(data, f.key) ?? ''
          for (const f of p.secrets) next[f.key] = ''
        }
        setForm(next)
      })
      .catch((err) => toast(err.message, 'danger'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { reload() }, [])

  const cfgFor = (k) => config.find((c) => c.key === k) ?? {}
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  async function save() {
    setSaving(true)
    try {
      const body = {}
      for (const p of PROVIDERS) {
        body[`${p.id}_enabled`]     = !!form[`${p.id}_enabled`]
        body[`${p.id}_environment`] = form[`${p.id}_environment`] || 'sandbox'
        for (const f of p.plain) {
          body[f.key] = form[f.key]?.trim() || null
        }
        for (const f of p.secrets) {
          if (form[f.key]) body[f.key] = form[f.key]
        }
      }
      await api.patch('/api/shipping/admin/config', body)
      toast('Shipping configurado')
      reload()
    } catch (err) {
      toast(err.message ?? 'Error guardando', 'danger')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="p-10 text-center text-ink3">Cargando…</div>

  return (
    <div className="p-8 max-w-4xl fade-up">
      <div className="mb-8">
        <div className="text-[12px] uppercase tracking-[0.18em] text-ink3 mb-2">Configuración / Shipping</div>
        <h1 className="font-display text-[44px] leading-none tracking-tight">
          <span className="italic font-normal">Carriers de envío</span>
        </h1>
        <p className="text-ink3 mt-3 max-w-2xl">
          Credenciales de plataforma para los carriers de paquetería (UPS, FedEx, DHL, EasyPost).
          Las claves se guardan cifradas. La configuración por-tenant (zonas, tarifas, carrier por defecto)
          vive en las tablas <code className="font-mono">zones</code>/<code className="font-mono">rates</code> existentes.
        </p>
      </div>

      <div className="space-y-6">
        {PROVIDERS.map((p) => (
          <div key={p.id} className="card p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-[20px] font-semibold">{p.name}</h2>
                <a href={p.docs} target="_blank" rel="noreferrer" className="text-[12px] text-ink3 hover:text-ink underline">
                  {p.docs}
                </a>
              </div>
              <label className="inline-flex items-center gap-2 text-[13px]">
                <input
                  type="checkbox"
                  checked={!!form[`${p.id}_enabled`]}
                  onChange={(e) => setField(`${p.id}_enabled`, e.target.checked)}
                />
                Habilitado
              </label>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-[12px] uppercase tracking-[0.14em] text-ink3 mb-1">Environment</label>
                <select
                  value={form[`${p.id}_environment`] ?? 'sandbox'}
                  onChange={(e) => setField(`${p.id}_environment`, e.target.value)}
                  className="input w-full"
                >
                  <option value="sandbox">sandbox</option>
                  <option value="production">production</option>
                </select>
              </div>
              {p.plain.map((f) => (
                <div key={f.key}>
                  <label className="block text-[12px] uppercase tracking-[0.14em] text-ink3 mb-1">{f.label}</label>
                  <input
                    value={form[f.key] ?? ''}
                    onChange={(e) => setField(f.key, e.target.value)}
                    className="input w-full font-mono text-[13px]"
                  />
                </div>
              ))}
            </div>

            <div className="space-y-4">
              {p.secrets.map((f) => (
                <SecretInput
                  key={f.key}
                  label={f.label}
                  configured={cfgFor(f.key).configured}
                  value={form[f.key] ?? ''}
                  onChange={(v) => setField(f.key, v)}
                />
              ))}
            </div>
          </div>
        ))}

        <div className="flex justify-end">
          <button onClick={save} disabled={saving} className="btn btn-primary">
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}

function pickPlain(data, key) {
  return data.find((c) => c.key === key)?.value ?? null
}
