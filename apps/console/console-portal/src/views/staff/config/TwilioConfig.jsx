import { useEffect, useState } from 'react'
import { useApp } from '../../../context/AppContext'
import { api } from '../../../lib/api'
import SecretInput from '../../../components/SecretInput'

export default function TwilioConfig() {
  const { toast } = useApp()
  const [config, setConfig] = useState([])
  const [loading, setLoading] = useState(true)
  const [accountSid, setAccountSid] = useState('')
  const [apiKeySid, setApiKeySid] = useState('')
  const [apiKeySecret, setApiKeySecret] = useState('')
  const [messagingServiceSid, setMessagingServiceSid] = useState('')
  const [defaultSender, setDefaultSender] = useState('')
  const [saving, setSaving] = useState(false)
  const [testTo, setTestTo] = useState('')
  const [testBody, setTestBody] = useState('Test from AppHub notifications.')
  const [testing, setTesting] = useState(false)

  function reload() {
    setLoading(true)
    api.get('/api/notifications/admin/config')
      .then((r) => {
        const data = r?.data ?? []
        setConfig(data)
        const pick = (k) => data.find((c) => c.key === k)?.value ?? ''
        setAccountSid(pick('twilio_account_sid'))
        setApiKeySid(pick('twilio_api_key_sid'))
        setMessagingServiceSid(pick('twilio_messaging_service_sid'))
        setDefaultSender(pick('twilio_default_sender'))
      })
      .catch((err) => toast(err.message ?? 'Error', 'danger'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { reload() }, [])

  const cfgFor = (k) => config.find((c) => c.key === k) ?? {}

  async function save() {
    setSaving(true)
    try {
      const body = {
        twilio_account_sid:           accountSid?.trim() || null,
        twilio_api_key_sid:           apiKeySid?.trim() || null,
        twilio_messaging_service_sid: messagingServiceSid?.trim() || null,
        twilio_default_sender:        defaultSender?.trim() || null,
      }
      if (apiKeySecret) body.twilio_api_key_secret = apiKeySecret
      await api.patch('/api/notifications/admin/config', body)
      toast('Twilio configurado')
      setApiKeySecret('')
      reload()
    } catch (err) {
      toast(err.message ?? 'Error guardando', 'danger')
    } finally {
      setSaving(false)
    }
  }

  async function sendTest() {
    if (!testTo.trim()) return
    setTesting(true)
    try {
      const r = await api.post('/api/notifications/admin/sms/test', {
        to: testTo.trim(),
        body: testBody?.trim() || undefined,
      })
      const data = r?.data ?? {}
      if (data.stub) toast('Twilio en modo stub — SMS solo logueado', 'warn')
      else if (data.sid) toast(`SMS enviado · sid=${data.sid}`)
      else if (data.error) toast(`Error Twilio: ${data.error}`, 'danger')
      else toast('Resultado desconocido', 'warn')
    } catch (err) {
      toast(err.message ?? 'Error', 'danger')
    } finally {
      setTesting(false)
    }
  }

  if (loading) return <div className="p-10 text-center text-ink3">Cargando…</div>

  return (
    <div className="p-8 max-w-3xl fade-up">
      <div className="mb-8">
        <div className="text-[12px] uppercase tracking-[0.18em] text-ink3 mb-2">Configuración / Notifications</div>
        <h1 className="font-display text-[44px] leading-none tracking-tight">
          <span className="italic font-normal">Twilio</span> SMS
        </h1>
        <p className="text-ink3 mt-3 max-w-2xl">
          Credenciales de Twilio que el módulo <code className="font-mono text-ink">platform/notifications</code> usa
          para enviar SMS. Si no se configura ninguna API key, los envíos quedan en modo stub (solo log).
        </p>
      </div>

      <div className="card p-6 space-y-5">
        <div>
          <label className="block text-[12px] uppercase tracking-[0.14em] text-ink3 mb-1">Account SID</label>
          <input value={accountSid} onChange={(e) => setAccountSid(e.target.value)} placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" className="input w-full font-mono text-[13px]" />
        </div>
        <div>
          <label className="block text-[12px] uppercase tracking-[0.14em] text-ink3 mb-1">API Key SID</label>
          <input value={apiKeySid} onChange={(e) => setApiKeySid(e.target.value)} placeholder="SKxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" className="input w-full font-mono text-[13px]" />
          <div className="text-[11px] text-ink3 mt-1">Crea una API Key en Twilio Console → Account → API Keys; preferido sobre el Auth Token raíz.</div>
        </div>
        <SecretInput label="API Key Secret" configured={cfgFor('twilio_api_key_secret').configured} value={apiKeySecret} onChange={setApiKeySecret} />

        <div className="border-t border-line pt-5">
          <div className="font-display text-[14px] mb-3">Sender</div>
          <div className="text-[12px] text-ink3 mb-3">
            Configura un Messaging Service SID (recomendado) o un número remitente directo.
            Si se configuran ambos, prevalece el Messaging Service.
          </div>
          <div>
            <label className="block text-[12px] uppercase tracking-[0.14em] text-ink3 mb-1">Messaging Service SID</label>
            <input value={messagingServiceSid} onChange={(e) => setMessagingServiceSid(e.target.value)} placeholder="MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" className="input w-full font-mono text-[13px]" />
          </div>
          <div className="mt-3">
            <label className="block text-[12px] uppercase tracking-[0.14em] text-ink3 mb-1">Default sender (E.164 / Alpha)</label>
            <input value={defaultSender} onChange={(e) => setDefaultSender(e.target.value)} placeholder="+34911234567 o AppHub" className="input w-full font-mono text-[13px]" />
          </div>
        </div>

        <div className="flex justify-end">
          <button onClick={save} disabled={saving} className="btn btn-primary">{saving ? 'Guardando…' : 'Guardar'}</button>
        </div>
      </div>

      <div className="card p-6 mt-6">
        <div className="font-display text-[18px] mb-1">Probar envío</div>
        <div className="text-xs text-ink3 mb-4">Envía un SMS único al número que indiques (válido en formato E.164: <code className="font-mono">+34…</code>).</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="+34611222333" className="input font-mono text-[13px]" />
          <input value={testBody} onChange={(e) => setTestBody(e.target.value)} className="input text-[13px]" />
        </div>
        <div className="flex justify-end mt-4">
          <button onClick={sendTest} disabled={testing || !testTo.trim()} className="btn btn-ghost">{testing ? 'Enviando…' : 'Enviar test'}</button>
        </div>
      </div>
    </div>
  )
}
