import { useEffect, useState } from 'react'
import { useApp } from '../../../context/AppContext'
import { api } from '../../../lib/api'
import { adaptTenant } from '../../../lib/adapters'

// Configuración de Veri*Factu (SIF) por tenant desde la consola de staff.
//
// A diferencia de Stripe (claves globales), la config de verifactu es POR
// TENANT: cada obligado tributario es una entidad legal con su propio NIF, su
// certificado cualificado y su entorno (test/prod). El staff elige el tenant y
// la consola opera sobre él vía IMPERSONACIÓN (?appId=&tenantId=), que el
// backend permite a super_admin/staff. Las mutaciones van con requireRole.
export default function VerifactuConfig() {
  const { toast } = useApp()
  const [tenants, setTenants] = useState([])
  const [sel, setSel] = useState(null)          // { appId, tenantId, name, cif }
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  // config del tenant seleccionado
  const [cfg, setCfg] = useState(null)
  const [certs, setCerts] = useState([])
  const [cola, setCola] = useState(null)

  // alta de certificado
  const [certFile, setCertFile] = useState(null) // base64 del .p12
  const [certName, setCertName] = useState('')
  const [certPass, setCertPass] = useState('')
  const [certUso, setCertUso] = useState('firma')

  // ── carga de tenants (selector) ───────────────────────────────────────
  useEffect(() => {
    api.get('/api/tenants/tenants')
      .then((r) => setTenants((r?.data ?? r ?? []).map(adaptTenant).filter(Boolean)))
      .catch((err) => toast(err.message ?? 'Error cargando tenants', 'danger'))
  }, [])

  const qs = () => `appId=${encodeURIComponent(sel.appId)}&tenantId=${encodeURIComponent(sel.tenantId)}`

  function selectTenant(t) {
    if (!t) { setSel(null); setCfg(null); setCerts([]); setCola(null); return }
    setSel({ appId: t.app_id, tenantId: t.id, name: t.name, cif: t.cif })
  }

  // ── recarga config + certs + cola del tenant elegido ──────────────────
  function reload() {
    if (!sel) return
    setLoading(true)
    Promise.all([
      api.get(`/api/verifactu/config?${qs()}`),
      api.get(`/api/verifactu/certificados?${qs()}`),
      api.get(`/api/verifactu/cola?${qs()}`).catch(() => null),
    ])
      .then(([c, ce, co]) => {
        setCfg(c?.data ?? c)
        setCerts(ce?.data ?? ce ?? [])
        setCola(co?.data ?? co ?? null)
      })
      .catch((err) => toast(err.message ?? 'Error cargando configuración', 'danger'))
      .finally(() => setLoading(false))
  }
  useEffect(() => { reload() /* eslint-disable-next-line */ }, [sel?.tenantId])

  const set = (k, v) => setCfg((c) => ({ ...c, [k]: v }))

  async function saveConfig() {
    setSaving(true)
    try {
      const body = {
        nifObligado: cfg.nifObligado || undefined,
        nombreObligado: cfg.nombreObligado || undefined,
        entorno: cfg.entorno,
        tiempoEsperaEnvio: cfg.tiempoEsperaEnvio != null ? Number(cfg.tiempoEsperaEnvio) : undefined,
        maxRegistrosLote: cfg.maxRegistrosLote != null ? Number(cfg.maxRegistrosLote) : undefined,
        reintentos: cfg.reintentos != null ? Number(cfg.reintentos) : undefined,
        dlqEnabled: cfg.dlqEnabled,
      }
      await api.patch(`/api/verifactu/config?${qs()}`, body)
      toast('Configuración Veri*Factu guardada')
      reload()
    } catch (err) {
      toast(err.message ?? 'Error guardando', 'danger')
    } finally {
      setSaving(false)
    }
  }

  function onCertFile(e) {
    const file = e.target.files?.[0]
    if (!file) { setCertFile(null); return }
    if (!certName) setCertName(file.name.replace(/\.(p12|pfx)$/i, ''))
    const reader = new FileReader()
    reader.onload = (ev) => setCertFile(String(ev.target.result).split(',')[1]) // quita "data:...;base64,"
    reader.onerror = () => toast('No se pudo leer el fichero', 'danger')
    reader.readAsDataURL(file)
  }

  async function subirCert() {
    if (!certFile) { toast('Selecciona un fichero .p12/.pfx', 'warning'); return }
    setSaving(true)
    try {
      await api.post(`/api/verifactu/certificados?${qs()}`, {
        nombre: certName || undefined, pkcs12Base64: certFile, passphrase: certPass || undefined, uso: certUso,
      })
      toast('Certificado subido y cifrado')
      setCertFile(null); setCertName(''); setCertPass(''); setCertUso('firma')
      reload()
    } catch (err) {
      toast(err.message ?? 'Error subiendo el certificado', 'danger')
    } finally {
      setSaving(false)
    }
  }

  async function borrarCert(id) {
    if (!window.confirm('¿Revocar/eliminar este certificado?')) return
    try {
      await api.delete(`/api/verifactu/certificados/${id}?${qs()}`)
      toast('Certificado eliminado')
      reload()
    } catch (err) {
      toast(err.message ?? 'Error eliminando', 'danger')
    }
  }

  const fmtDate = (d) => (d ? String(d).slice(0, 10) : '—')

  return (
    <div className="p-8 max-w-4xl fade-up">
      <div className="mb-8">
        <div className="text-[12px] uppercase tracking-[0.18em] text-ink3 mb-2">Configuración / Veri*Factu</div>
        <h1 className="font-display text-[44px] leading-none tracking-tight">
          <span className="italic font-normal">Veri*Factu</span> (SIF)
        </h1>
        <p className="text-ink3 mt-3 max-w-2xl">
          Datos del obligado, entorno AEAT (test/prod), parámetros de remisión y
          certificado cualificado <strong>por tenant</strong> — cada obligado es una entidad legal
          distinta. La clave privada del PKCS#12 se guarda <strong>cifrada</strong> (AES-256-GCM); nunca se muestra.
        </p>
      </div>

      {/* Selector de tenant */}
      <div className="card p-6 mb-6">
        <label className="block text-[12px] uppercase tracking-[0.14em] text-ink3 mb-1">Tenant (obligado tributario)</label>
        <select
          className="input w-full text-[13px]"
          value={sel?.tenantId ?? ''}
          onChange={(e) => selectTenant(tenants.find((t) => t.id === e.target.value))}
        >
          <option value="">— Selecciona un tenant —</option>
          {tenants.map((t) => (
            <option key={t.id} value={t.id}>{t.name} · {t.app_id}{t.cif ? ` · ${t.cif}` : ''}</option>
          ))}
        </select>
      </div>

      {!sel && <div className="text-ink3 text-[13px]">Selecciona un tenant para configurar su Veri*Factu.</div>}
      {sel && loading && <div className="p-10 text-center text-ink3">Cargando…</div>}

      {sel && !loading && cfg && (
        <div className="space-y-6">
          {/* Emisor + entorno */}
          <div className="card p-6 space-y-5">
            <h2 className="font-medium">Obligado tributario y entorno</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[12px] uppercase tracking-[0.14em] text-ink3 mb-1">NIF del obligado</label>
                <input value={cfg.nifObligado ?? ''} onChange={(e) => set('nifObligado', e.target.value)} placeholder={sel.cif || 'B12345678'} className="input w-full font-mono text-[13px]" />
              </div>
              <div>
                <label className="block text-[12px] uppercase tracking-[0.14em] text-ink3 mb-1">Razón social</label>
                <input value={cfg.nombreObligado ?? ''} onChange={(e) => set('nombreObligado', e.target.value)} placeholder={sel.name} className="input w-full text-[13px]" />
              </div>
            </div>
            <div>
              <label className="block text-[12px] uppercase tracking-[0.14em] text-ink3 mb-1">Entorno AEAT</label>
              <select value={cfg.entorno ?? 'test'} onChange={(e) => set('entorno', e.target.value)} className="input w-full text-[13px]">
                <option value="test">test — preproducción (prewww1)</option>
                <option value="prod">prod — producción (www1)</option>
              </select>
              <p className="text-[12px] text-ink3 mt-1">Determina contra qué servicio SOAP de la AEAT se remite. Cambia a <code className="font-mono">prod</code> sólo con un certificado real cargado.</p>
            </div>
          </div>

          {/* Parámetros de flujo */}
          <div className="card p-6 space-y-5">
            <h2 className="font-medium">Parámetros de remisión</h2>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-[12px] uppercase tracking-[0.14em] text-ink3 mb-1">Tiempo espera envío (s)</label>
                <input type="number" min="0" value={cfg.tiempoEsperaEnvio ?? ''} onChange={(e) => set('tiempoEsperaEnvio', e.target.value)} className="input w-full font-mono text-[13px]" />
              </div>
              <div>
                <label className="block text-[12px] uppercase tracking-[0.14em] text-ink3 mb-1">Máx registros / lote</label>
                <input type="number" min="1" max="1000" value={cfg.maxRegistrosLote ?? ''} onChange={(e) => set('maxRegistrosLote', e.target.value)} className="input w-full font-mono text-[13px]" />
              </div>
              <div>
                <label className="block text-[12px] uppercase tracking-[0.14em] text-ink3 mb-1">Reintentos (→ DLQ)</label>
                <input type="number" min="0" value={cfg.reintentos ?? ''} onChange={(e) => set('reintentos', e.target.value)} className="input w-full font-mono text-[13px]" />
              </div>
            </div>
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={!!cfg.dlqEnabled} onChange={(e) => set('dlqEnabled', e.target.checked)} />
              DLQ activada (los registros que agotan reintentos van a dead-letter)
            </label>
            <div className="flex justify-end">
              <button onClick={saveConfig} disabled={saving} className="btn btn-primary">{saving ? 'Guardando…' : 'Guardar configuración'}</button>
            </div>
          </div>

          {/* Certificados */}
          <div className="card p-6 space-y-5">
            <h2 className="font-medium">Certificados (PKCS#12)</h2>
            {certs.length === 0 && <p className="text-[13px] text-ink3">Sin certificados. Sube el certificado cualificado del obligado para poder remitir.</p>}
            {certs.length > 0 && (
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-ink3 text-left text-[12px] uppercase tracking-[0.12em]">
                    <th className="py-1">CN</th><th>Emisor</th><th>Uso</th><th>Caduca</th><th>Estado</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {certs.map((c) => (
                    <tr key={c.id} className="border-t border-line">
                      <td className="py-2 font-mono">{c.cn ?? c.nombre}</td>
                      <td>{c.emisor ?? '—'}</td>
                      <td>{c.uso ?? 'firma'}</td>
                      <td className={c.caducaEn && new Date(c.caducaEn) < new Date() ? 'text-danger' : ''}>{fmtDate(c.caducaEn)}</td>
                      <td>{c.activo ? 'Activo' : 'Inactivo'}</td>
                      <td className="text-right"><button onClick={() => borrarCert(c.id)} className="btn btn-ghost btn-sm text-danger">Eliminar</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div className="border-t border-line pt-4 space-y-3">
              <div className="text-[12px] uppercase tracking-[0.14em] text-ink3">Subir certificado</div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[12px] text-ink3 mb-1">Fichero .p12 / .pfx</label>
                  <input type="file" accept=".p12,.pfx" onChange={onCertFile} className="text-[13px]" />
                </div>
                <div>
                  <label className="block text-[12px] text-ink3 mb-1">Nombre (opcional)</label>
                  <input value={certName} onChange={(e) => setCertName(e.target.value)} className="input w-full text-[13px]" />
                </div>
                <div>
                  <label className="block text-[12px] text-ink3 mb-1">Passphrase</label>
                  <input type="password" value={certPass} onChange={(e) => setCertPass(e.target.value)} className="input w-full text-[13px]" />
                </div>
                <div>
                  <label className="block text-[12px] text-ink3 mb-1">Uso</label>
                  <select value={certUso} onChange={(e) => setCertUso(e.target.value)} className="input w-full text-[13px]">
                    <option value="firma">firma (persona/representante)</option>
                    <option value="sello">sello (empresa)</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end">
                <button onClick={subirCert} disabled={saving || !certFile} className="btn btn-primary">{saving ? 'Subiendo…' : 'Subir certificado'}</button>
              </div>
            </div>
          </div>

          {/* Estado de la cola */}
          {cola?.resumen && (
            <div className="card p-6">
              <h2 className="font-medium mb-3">Cola de remisión</h2>
              <div className="flex gap-6 text-[13px] font-mono">
                {Object.entries(cola.resumen).map(([k, v]) => (
                  <span key={k} className={k === 'dlq' && v > 0 ? 'text-danger' : 'text-ink3'}>{k}: <strong className="text-ink">{v}</strong></span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
