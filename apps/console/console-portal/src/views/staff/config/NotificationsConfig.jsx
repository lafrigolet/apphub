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
  const [rateHour, setRateHour] = useState('')
  const [rateDay, setRateDay] = useState('')
  const [digestMode, setDigestMode] = useState('off')
  const [saving, setSaving] = useState(false)

  function reload() {
    setLoading(true)
    api.get('/api/notifications/admin/config')
      .then((r) => {
        const data = r?.data ?? []
        setConfig(data)
        const pick = (k) => data.find((c) => c.key === k)?.value ?? ''
        setSenderEmail(pick('sender_email'))
        setSenderName(pick('sender_name'))
        setRateHour(pick('rate_limit_per_user_per_hour'))
        setRateDay(pick('rate_limit_per_user_per_day'))
        setDigestMode(pick('digest_mode') || 'off')
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
        sender_email: senderEmail || null,
        sender_name:  senderName || null,
        rate_limit_per_user_per_hour: rateHour?.trim() || null,
        rate_limit_per_user_per_day:  rateDay?.trim()  || null,
        digest_mode:  digestMode || 'off',
      }
      if (apiKey) body.sendgrid_api_key = apiKey
      await api.patch('/api/notifications/admin/config', body)
      toast('Configuración guardada')
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
          <input type="email" value={senderEmail} onChange={(e) => setSenderEmail(e.target.value)} placeholder="noreply@hulkstein.com" className="input w-full font-mono text-[13px]" />
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

      <div className="card p-6 space-y-5 mt-6">
        <div>
          <div className="font-display text-[18px] mb-1">Digest mode</div>
          <div className="text-xs text-ink3 mb-3">
            Cuando está en <code className="font-mono">daily</code>, los eventos no urgentes (booking.confirmed/cancelled/rescheduled,
            reservation.created/cancelled, package.exhausted, payout.paid) se acumulan en una cola por usuario y se envían en un único
            email diario por <code className="font-mono">platform-scheduler</code> a las 09:00 UTC.
            Recordatorios y resets de contraseña siempre van inmediatos.
          </div>
        </div>
        <div>
          <label className="block text-[12px] uppercase tracking-[0.14em] text-ink3 mb-1">Modo</label>
          <select value={digestMode} onChange={(e) => setDigestMode(e.target.value)} className="select">
            <option value="off">off — un email por evento</option>
            <option value="daily">daily — un email por día con todo agrupado</option>
          </select>
        </div>
      </div>

      <div className="card p-6 space-y-5 mt-6">
        <div>
          <div className="font-display text-[18px] mb-1">Rate limiting</div>
          <div className="text-xs text-ink3 mb-3">
            Topes por usuario para evitar inundar a un destinatario. Vacío o 0 = ilimitado.
            Aplica a email y SMS por separado, etiquetado por <code className="font-mono">event_class</code>.
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-[12px] uppercase tracking-[0.14em] text-ink3 mb-1">Por usuario y hora</label>
            <input value={rateHour} onChange={(e) => setRateHour(e.target.value)} placeholder="20" className="input w-full font-mono text-[13px]" />
          </div>
          <div>
            <label className="block text-[12px] uppercase tracking-[0.14em] text-ink3 mb-1">Por usuario y día</label>
            <input value={rateDay} onChange={(e) => setRateDay(e.target.value)} placeholder="100" className="input w-full font-mono text-[13px]" />
          </div>
        </div>
      </div>
    </div>
  )
}
