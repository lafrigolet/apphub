import { useEffect, useState } from 'react'
import { useApp } from '../../../context/AppContext'
import { api } from '../../../lib/api'
import SecretInput from '../../../components/SecretInput'

export default function NotificationsConfig() {
  const { toast, navigate } = useApp()
  const [config, setConfig] = useState([])
  const [loading, setLoading] = useState(true)
  const [apiKey, setApiKey] = useState('')
  const [senderEmail, setSenderEmail] = useState('')
  const [senderName, setSenderName] = useState('')
  const [saving, setSaving] = useState(false)

  function reload() {
    setLoading(true)
    api.get('/api/notifications/admin/config')
      .then((r) => {
        const data = r?.data ?? []
        setConfig(data)
        setSenderEmail(data.find((c) => c.key === 'sender_email')?.value ?? '')
        setSenderName(data.find((c) => c.key === 'sender_name')?.value ?? '')
      })
      .catch((err) => toast(err.message ?? 'Error', 'danger'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { reload() }, [])

  const cfgFor = (k) => config.find((c) => c.key === k) ?? {}

  async function save() {
    setSaving(true)
    try {
      const body = { sender_email: senderEmail || null, sender_name: senderName || null }
      if (apiKey) body.sendgrid_api_key = apiKey
      await api.patch('/api/notifications/admin/config', body)
      toast('SendGrid configurado')
      setApiKey('')
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
        <div className="text-[12px] uppercase tracking-[0.18em] text-ink3 mb-2">Configuración / Notifications</div>
        <h1 className="font-display text-[44px] leading-none tracking-tight">
          <span className="italic font-normal">SendGrid</span>
        </h1>
        <p className="text-ink3 mt-3 max-w-2xl">
          Cuenta de SendGrid usada por el módulo <code className="font-mono text-ink">platform/notifications</code> para enviar emails. La API key se guarda cifrada.
        </p>
      </div>

      <div className="card p-6 space-y-5">
        <SecretInput label="API key (SG.…)" configured={cfgFor('sendgrid_api_key').configured} value={apiKey} onChange={setApiKey} />

        <div>
          <label className="block text-[12px] uppercase tracking-[0.14em] text-ink3 mb-1">Sender email</label>
          <input type="email" value={senderEmail} onChange={(e) => setSenderEmail(e.target.value)} placeholder="noreply@apphub.com" className="input w-full font-mono text-[13px]" />
        </div>

        <div>
          <label className="block text-[12px] uppercase tracking-[0.14em] text-ink3 mb-1">Sender name</label>
          <input type="text" value={senderName} onChange={(e) => setSenderName(e.target.value)} placeholder="AppHub" className="input w-full text-[13px]" />
        </div>

        <div className="flex justify-end gap-3">
          <button onClick={() => navigate('config-notifications-templates')} className="btn btn-ghost">Plantillas →</button>
          <button onClick={save} disabled={saving} className="btn btn-primary">{saving ? 'Guardando…' : 'Guardar'}</button>
        </div>
      </div>
    </div>
  )
}
