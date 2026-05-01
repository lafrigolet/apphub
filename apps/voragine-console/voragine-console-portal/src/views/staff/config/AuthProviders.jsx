import { useEffect, useState } from 'react'
import { useApp } from '../../../context/AppContext'
import { api } from '../../../lib/api'
import SecretInput from '../../../components/SecretInput'

const PROVIDERS = [
  { id: 'google',   label: 'Google',
    hint: 'OAuth client_id + client_secret de la consola de Google Cloud (https://console.cloud.google.com/apis/credentials).' },
  { id: 'facebook', label: 'Facebook',
    hint: 'App ID + App Secret de Facebook for Developers (https://developers.facebook.com/apps).' },
]

function ProviderForm({ p, initial, onSaved }) {
  const { toast } = useApp()
  const [clientId, setClientId] = useState(initial.clientId ?? '')
  const [clientSecret, setClientSecret] = useState('')
  const [enabled, setEnabled] = useState(initial.enabled ?? false)
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    try {
      const body = { clientId, enabled }
      if (clientSecret) body.clientSecret = clientSecret
      const r = await api.patch(`/api/auth/admin/oauth-providers/${p.id}`, body)
      toast(`${p.label} guardado`)
      onSaved?.(r?.data)
      setClientSecret('')
    } catch (err) {
      toast(err.message ?? 'Error guardando provider', 'danger')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card p-6 space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-[18px] font-semibold">{p.label}</h3>
          <p className="text-[13px] text-ink3 mt-1 max-w-xl">{p.hint}</p>
        </div>
        <label className="inline-flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Habilitado
        </label>
      </div>

      <div>
        <label className="block text-[12px] uppercase tracking-[0.14em] text-ink3 mb-1">Client ID</label>
        <input
          type="text" value={clientId} onChange={(e) => setClientId(e.target.value)}
          placeholder="123456789-abcdef.apps.googleusercontent.com"
          className="input w-full font-mono text-[13px]"
        />
      </div>

      <SecretInput
        label="Client Secret"
        configured={initial.configured}
        value={clientSecret}
        onChange={setClientSecret}
        placeholder="Pega aquí el secret y guarda"
      />

      <div className="flex justify-end">
        <button onClick={save} disabled={saving} className="btn btn-primary">
          {saving ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </div>
  )
}

export default function AuthProviders() {
  const { toast } = useApp()
  const [providers, setProviders] = useState([])
  const [loading, setLoading] = useState(true)

  function reload() {
    setLoading(true)
    api.get('/api/auth/admin/oauth-providers')
      .then((r) => setProviders(r?.data ?? []))
      .catch((err) => toast(err.message ?? 'Error cargando providers', 'danger'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { reload() }, [])

  if (loading) return <div className="p-10 text-center text-ink3">Cargando…</div>

  return (
    <div className="p-8 max-w-4xl fade-up">
      <div className="mb-8">
        <div className="text-[12px] uppercase tracking-[0.18em] text-ink3 mb-2">Configuración / Auth</div>
        <h1 className="font-display text-[44px] leading-none tracking-tight">
          <span className="italic font-normal">OAuth Providers</span>
        </h1>
        <p className="text-ink3 mt-3 max-w-2xl">
          Credenciales de inicio de sesión social. Los <code className="font-mono text-ink">client_secret</code> se cifran con AES-256-GCM antes de guardarlos en la base de datos.
        </p>
      </div>

      <div className="space-y-6">
        {PROVIDERS.map((p) => {
          const initial = providers.find((x) => x.provider === p.id) ?? { configured: false, enabled: false, clientId: null }
          return <ProviderForm key={p.id} p={p} initial={initial} onSaved={reload} />
        })}
      </div>
    </div>
  )
}
