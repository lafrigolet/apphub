import { useEffect, useState } from 'react'
import { useApp } from '../../../context/AppContext'
import { api } from '../../../lib/api'
import SecretInput from '../../../components/SecretInput'

export default function StorageConfig() {
  const { toast } = useApp()
  const [config, setConfig] = useState([])
  const [kinds, setKinds] = useState([])
  const [loading, setLoading] = useState(true)
  const [endpoint, setEndpoint] = useState('')
  const [publicEndpoint, setPublicEndpoint] = useState('')
  const [region, setRegion] = useState('')
  const [bucket, setBucket] = useState('')
  const [forcePathStyle, setForcePathStyle] = useState(true)
  const [accessKey, setAccessKey] = useState('')
  const [secretKey, setSecretKey] = useState('')
  const [saving, setSaving] = useState(false)

  function reload() {
    setLoading(true)
    Promise.all([
      api.get('/api/storage/admin/config'),
      api.get('/api/storage/admin/kinds'),
    ])
      .then(([cfg, ks]) => {
        const data = cfg?.data ?? []
        setConfig(data)
        setKinds(ks?.data ?? [])
        const pick = (k) => data.find((c) => c.key === k)?.value ?? ''
        setEndpoint(pick('s3_endpoint'))
        setPublicEndpoint(pick('s3_public_endpoint'))
        setRegion(pick('s3_region'))
        setBucket(pick('s3_bucket'))
        setForcePathStyle(pick('s3_force_path_style') !== 'false')
      })
      .catch((err) => toast(err.message, 'danger'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { reload() }, [])

  const cfgFor = (k) => config.find((c) => c.key === k) ?? {}

  async function save() {
    setSaving(true)
    try {
      const body = {
        s3_endpoint:         endpoint || null,
        s3_public_endpoint:  publicEndpoint || null,
        s3_region:           region || null,
        s3_bucket:           bucket || null,
        s3_force_path_style: forcePathStyle,
      }
      if (accessKey) body.s3_access_key = accessKey
      if (secretKey) body.s3_secret_key = secretKey
      await api.patch('/api/storage/admin/config', body)
      toast('Storage configurado')
      setAccessKey(''); setSecretKey('')
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
        <div className="text-[12px] uppercase tracking-[0.18em] text-ink3 mb-2">Configuración / Storage</div>
        <h1 className="font-display text-[44px] leading-none tracking-tight">
          <span className="italic font-normal">Object storage</span>
        </h1>
        <p className="text-ink3 mt-3 max-w-2xl">
          Backend S3-compatible (MinIO en dev, AWS S3 / Cloudflare R2 / Backblaze B2 en prod). Las credenciales se guardan cifradas.
        </p>
      </div>

      <div className="card p-6 space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[12px] uppercase tracking-[0.14em] text-ink3 mb-1">Endpoint (interno)</label>
            <input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="http://minio:9000" className="input w-full font-mono text-[13px]" />
          </div>
          <div>
            <label className="block text-[12px] uppercase tracking-[0.14em] text-ink3 mb-1">Endpoint (público — para presigned URLs)</label>
            <input value={publicEndpoint} onChange={(e) => setPublicEndpoint(e.target.value)} placeholder="http://localhost:9000" className="input w-full font-mono text-[13px]" />
          </div>
          <div>
            <label className="block text-[12px] uppercase tracking-[0.14em] text-ink3 mb-1">Region</label>
            <input value={region} onChange={(e) => setRegion(e.target.value)} placeholder="us-east-1" className="input w-full font-mono text-[13px]" />
          </div>
          <div>
            <label className="block text-[12px] uppercase tracking-[0.14em] text-ink3 mb-1">Bucket</label>
            <input value={bucket} onChange={(e) => setBucket(e.target.value)} placeholder="apphub" className="input w-full font-mono text-[13px]" />
          </div>
        </div>

        <label className="inline-flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={forcePathStyle} onChange={(e) => setForcePathStyle(e.target.checked)} />
          Force path-style URLs (necesario en MinIO)
        </label>

        <SecretInput label="Access key" configured={cfgFor('s3_access_key').configured} value={accessKey} onChange={setAccessKey} />
        <SecretInput label="Secret key" configured={cfgFor('s3_secret_key').configured} value={secretKey} onChange={setSecretKey} />

        <div className="flex justify-end">
          <button onClick={save} disabled={saving} className="btn btn-primary">{saving ? 'Guardando…' : 'Guardar'}</button>
        </div>
      </div>

      <div className="mt-10">
        <h2 className="text-[18px] font-semibold mb-3">Kinds registrados ({kinds.length})</h2>
        <p className="text-[13px] text-ink3 mb-4">Catálogo de tipos de objeto. Definidos en código (<code className="font-mono">platform/storage/src/kinds.js</code>); para añadir uno hace falta un PR.</p>
        <div className="card overflow-hidden">
          <table className="w-full text-[13px]">
            <thead className="bg-paper2 text-ink3 uppercase text-[11px] tracking-wider">
              <tr><th className="text-left p-3">Kind</th><th className="text-left p-3">MIME</th><th className="text-left p-3">Max bytes</th><th className="text-left p-3">Retention</th></tr>
            </thead>
            <tbody>
              {kinds.map((k) => (
                <tr key={k.kind} className="border-t border-line">
                  <td className="p-3 font-mono">{k.kind}</td>
                  <td className="p-3 text-[12px]">{(k.mime ?? []).join(', ')}</td>
                  <td className="p-3 font-mono">{(k.maxBytes / (1024 * 1024)).toFixed(0)} MB</td>
                  <td className="p-3">{k.retentionDays == null ? <span className="text-ink3 italic">sin caducidad</span> : `${k.retentionDays} días`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
