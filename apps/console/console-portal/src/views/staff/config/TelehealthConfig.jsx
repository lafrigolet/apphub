import { useEffect, useState } from 'react'
import { useApp } from '../../../context/AppContext'
import { api } from '../../../lib/api'
import SecretInput from '../../../components/SecretInput'

const PROVIDERS = [
  {
    id: 'daily',
    name: 'Daily.co',
    docs: 'https://docs.daily.co/reference/rest-api',
    plain: [
      { key: 'daily_domain', label: 'Domain', placeholder: 'mycompany.daily.co' },
    ],
    secrets: [
      { key: 'daily_api_key', label: 'API Key' },
    ],
  },
  {
    id: 'twilio',
    name: 'Twilio Video',
    docs: 'https://www.twilio.com/docs/video',
    plain: [
      { key: 'twilio_account_sid', label: 'Account SID', placeholder: 'AC…' },
      { key: 'twilio_api_key_sid', label: 'API Key SID', placeholder: 'SK…' },
    ],
    secrets: [
      { key: 'twilio_api_key_secret', label: 'API Key Secret' },
    ],
  },
  {
    id: 'whereby',
    name: 'Whereby',
    docs: 'https://docs.whereby.com/whereby-api',
    plain: [
      { key: 'whereby_subdomain', label: 'Subdomain', placeholder: 'mycompany' },
    ],
    secrets: [
      { key: 'whereby_api_key', label: 'API Key (Bearer)' },
    ],
  },
  {
    id: 'jitsi',
    name: 'Jitsi as a Service (JaaS)',
    docs: 'https://developer.8x8.com/jaas/docs',
    plain: [
      { key: 'jitsi_app_id',     label: 'App ID',         placeholder: 'vpaas-magic-cookie-…' },
      { key: 'jitsi_api_key_id', label: 'API Key ID (kid)' },
    ],
    secrets: [
      { key: 'jitsi_private_key', label: 'Private Key (PEM, RSA)' },
    ],
  },
]

export default function TelehealthConfig() {
  const { toast } = useApp()
  const [config, setConfig] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [activeProvider, setActiveProvider] = useState('stub')
  const [form, setForm] = useState({})

  function reload() {
    setLoading(true)
    api.get('/api/telehealth/admin/config')
      .then((r) => {
        const data = r?.data ?? []
        setConfig(data)
        setActiveProvider(pickPlain(data, 'active_provider') || 'stub')
        const next = {}
        for (const p of PROVIDERS) {
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
      const body = { active_provider: activeProvider }
      for (const p of PROVIDERS) {
        for (const f of p.plain) {
          body[f.key] = form[f.key]?.trim() || null
        }
        for (const f of p.secrets) {
          if (form[f.key]) body[f.key] = form[f.key]
        }
      }
      await api.patch('/api/telehealth/admin/config', body)
      toast('Telehealth configurado')
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
        <div className="text-[12px] uppercase tracking-[0.18em] text-ink3 mb-2">Configuración / Telehealth</div>
        <h1 className="font-display text-[44px] leading-none tracking-tight">
          <span className="italic font-normal">Proveedor de video</span>
        </h1>
        <p className="text-ink3 mt-3 max-w-2xl">
          Credenciales de plataforma para el proveedor que aprovisiona las salas de telehealth.
          Solo un proveedor está activo a la vez. Si se selecciona <code className="font-mono">stub</code>,
          el módulo genera URLs/tokens opacos sin llamar a ningún servicio externo (modo desarrollo).
        </p>
      </div>

      <div className="card p-6 mb-6">
        <label className="block text-[12px] uppercase tracking-[0.14em] text-ink3 mb-2">Proveedor activo</label>
        <select
          value={activeProvider}
          onChange={(e) => setActiveProvider(e.target.value)}
          className="input w-full max-w-sm"
        >
          <option value="stub">stub (sin proveedor externo)</option>
          {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      <div className="space-y-6">
        {PROVIDERS.map((p) => (
          <div key={p.id} className={`card p-6 ${activeProvider === p.id ? '' : 'opacity-70'}`}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-[20px] font-semibold">
                  {p.name}
                  {activeProvider === p.id && (
                    <span className="ml-2 text-[11px] uppercase tracking-wider px-2 py-0.5 rounded bg-paper2 text-ink2 align-middle">
                      activo
                    </span>
                  )}
                </h2>
                <a href={p.docs} target="_blank" rel="noreferrer" className="text-[12px] text-ink3 hover:text-ink underline">
                  {p.docs}
                </a>
              </div>
            </div>

            {p.plain.length > 0 && (
              <div className="grid grid-cols-2 gap-4 mb-4">
                {p.plain.map((f) => (
                  <div key={f.key}>
                    <label className="block text-[12px] uppercase tracking-[0.14em] text-ink3 mb-1">{f.label}</label>
                    <input
                      value={form[f.key] ?? ''}
                      onChange={(e) => setField(f.key, e.target.value)}
                      placeholder={f.placeholder}
                      className="input w-full font-mono text-[13px]"
                    />
                  </div>
                ))}
              </div>
            )}

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
