import { useEffect, useState } from 'react'
import { useApp } from '../../../context/AppContext'
import { api } from '../../../lib/api'
import SecretInput from '../../../components/SecretInput'

// FCM HTTP v1 + reserved APNs slots. The actual native APNs HTTP/2 client is
// not implemented yet (FCM forwards to APNs when an iOS auth key is uploaded
// in the Firebase console), but the credentials are stored so a future
// migration can enable a direct path without UI changes.
export default function PushConfig() {
  const { toast } = useApp()
  const [config, setConfig] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [fcmProjectId, setFcmProjectId] = useState('')
  const [fcmServiceAccountJson, setFcmServiceAccountJson] = useState('')

  const [apnsTeamId, setApnsTeamId] = useState('')
  const [apnsKeyId, setApnsKeyId] = useState('')
  const [apnsBundleId, setApnsBundleId] = useState('')
  const [apnsP8Key, setApnsP8Key] = useState('')
  const [apnsEnvironment, setApnsEnvironment] = useState('production')

  function reload() {
    setLoading(true)
    api.get('/api/notifications/admin/config')
      .then((r) => {
        const data = r?.data ?? []
        setConfig(data)
        const pick = (k) => data.find((c) => c.key === k)?.value ?? ''
        setFcmProjectId(pick('fcm_project_id'))
        setApnsTeamId(pick('apns_team_id'))
        setApnsKeyId(pick('apns_key_id'))
        setApnsBundleId(pick('apns_bundle_id'))
        setApnsEnvironment(pick('apns_environment') || 'production')
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
        fcm_project_id:   fcmProjectId?.trim() || null,
        apns_team_id:     apnsTeamId?.trim() || null,
        apns_key_id:      apnsKeyId?.trim() || null,
        apns_bundle_id:   apnsBundleId?.trim() || null,
        apns_environment: apnsEnvironment || 'production',
      }
      if (fcmServiceAccountJson) body.fcm_service_account_json = fcmServiceAccountJson
      if (apnsP8Key)             body.apns_p8_key              = apnsP8Key
      await api.patch('/api/notifications/admin/config', body)
      toast('Push configurado')
      setFcmServiceAccountJson('')
      setApnsP8Key('')
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
          <span className="italic font-normal">Push</span>
        </h1>
        <p className="text-ink3 mt-3 max-w-2xl">
          Credenciales de FCM (Firebase Cloud Messaging) usadas para Android, iOS (vía APNs key subido a Firebase) y Web Push.
          Los slots de APNs nativo se reservan para una integración HTTP/2 directa futura.
        </p>
      </div>

      <div className="card p-6 space-y-5">
        <div className="font-display text-[18px]">FCM HTTP v1</div>
        <div>
          <label className="block text-[12px] uppercase tracking-[0.14em] text-ink3 mb-1">Project ID</label>
          <input value={fcmProjectId} onChange={(e) => setFcmProjectId(e.target.value)} placeholder="my-app-12345" className="input w-full font-mono text-[13px]" />
          <div className="text-[11px] text-ink3 mt-1">El <code className="font-mono">project_id</code> visible en la consola de Firebase.</div>
        </div>
        <SecretInput
          label="Service account JSON"
          configured={cfgFor('fcm_service_account_json').configured}
          value={fcmServiceAccountJson}
          onChange={setFcmServiceAccountJson}
          placeholder='{ "type": "service_account", … }'
        />
        <div className="text-[11px] text-ink3 -mt-3">
          Pega el JSON completo descargado de Firebase &gt; Project settings &gt; Service accounts &gt; Generate new private key. Se guarda cifrado.
        </div>
      </div>

      <div className="card p-6 space-y-5 mt-6">
        <div className="font-display text-[18px]">APNs (reservado)</div>
        <div className="text-[12px] text-ink3 -mt-3">
          Estos campos se persisten para una futura integración HTTP/2 directa con APNs.
          De momento el envío a iOS pasa por FCM (que reenvía a APNs).
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[12px] uppercase tracking-[0.14em] text-ink3 mb-1">Team ID</label>
            <input value={apnsTeamId} onChange={(e) => setApnsTeamId(e.target.value)} placeholder="ABCD123456" className="input w-full font-mono text-[13px]" />
          </div>
          <div>
            <label className="block text-[12px] uppercase tracking-[0.14em] text-ink3 mb-1">Key ID</label>
            <input value={apnsKeyId} onChange={(e) => setApnsKeyId(e.target.value)} placeholder="A1B2C3D4E5" className="input w-full font-mono text-[13px]" />
          </div>
          <div>
            <label className="block text-[12px] uppercase tracking-[0.14em] text-ink3 mb-1">Bundle ID</label>
            <input value={apnsBundleId} onChange={(e) => setApnsBundleId(e.target.value)} placeholder="com.example.app" className="input w-full font-mono text-[13px]" />
          </div>
          <div>
            <label className="block text-[12px] uppercase tracking-[0.14em] text-ink3 mb-1">Environment</label>
            <select value={apnsEnvironment} onChange={(e) => setApnsEnvironment(e.target.value)} className="input w-full">
              <option value="sandbox">sandbox</option>
              <option value="production">production</option>
            </select>
          </div>
        </div>
        <SecretInput
          label="APNs Auth Key (.p8)"
          configured={cfgFor('apns_p8_key').configured}
          value={apnsP8Key}
          onChange={setApnsP8Key}
          placeholder="-----BEGIN PRIVATE KEY-----…"
        />
      </div>

      <div className="flex justify-end mt-6">
        <button onClick={save} disabled={saving} className="btn btn-primary">{saving ? 'Guardando…' : 'Guardar'}</button>
      </div>
    </div>
  )
}
