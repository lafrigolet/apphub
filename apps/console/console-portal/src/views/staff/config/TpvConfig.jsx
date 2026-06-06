import { useEffect, useState } from 'react'
import { useApp } from '../../../context/AppContext'
import { api } from '../../../lib/api'

export default function TpvConfig() {
  const { toast } = useApp()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [autocloseHours, setAutocloseHours] = useState('')
  const [cashOutThreshold, setCashOutThreshold] = useState('')
  const [renderFooter, setRenderFooter] = useState('')

  function reload() {
    setLoading(true)
    api.get('/api/tpv/admin/config')
      .then((r) => {
        const data = r?.data ?? []
        const pick = (k) => data.find((c) => c.key === k)?.value ?? ''
        setAutocloseHours(pick('default_session_autoclose_hours'))
        setCashOutThreshold(pick('default_cash_out_manager_threshold_cents'))
        setRenderFooter(pick('receipt_render_footer'))
      })
      .catch((err) => toast(err.message, 'danger'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { reload() }, [])

  async function save() {
    setSaving(true)
    try {
      const body = {}
      if (autocloseHours !== '') body.default_session_autoclose_hours = Number(autocloseHours)
      if (cashOutThreshold !== '') body.default_cash_out_manager_threshold_cents = Number(cashOutThreshold)
      body.receipt_render_footer = renderFooter || null
      await api.patch('/api/tpv/admin/config', body)
      toast('TPV configurado')
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
        <div className="text-[12px] uppercase tracking-[0.18em] text-ink3 mb-2">Configuración / TPV</div>
        <h1 className="font-display text-[44px] leading-none tracking-tight">
          <span className="italic font-normal">TPV / Caja</span>
        </h1>
        <p className="text-ink3 mt-3 max-w-2xl">
          Defaults de plataforma del módulo TPV (contenedor <code className="font-mono">platform-tpv</code>, ADR 015).
          Los datos fiscales del <strong>emisor</strong> (NIF, razón social) son por tenant y se gestionan
          en <code className="font-mono">/v1/tpv/settings</code> — cada tenant es una entidad legal distinta.
        </p>
      </div>

      <div className="card p-6 space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[12px] uppercase tracking-[0.14em] text-ink3 mb-1">Autocierre de sesiones de caja (horas)</label>
            <input value={autocloseHours} onChange={(e) => setAutocloseHours(e.target.value)} placeholder="16" type="number" min="1" max="72" className="input w-full font-mono text-[13px]" />
            <p className="text-[12px] text-ink3 mt-1">Sesiones abiertas más de N horas se cierran forzosamente vía <code className="font-mono">tpv-session-autoclose</code> (scheduler). Los tenants pueden sobreescribirlo en sus settings.</p>
          </div>
          <div>
            <label className="block text-[12px] uppercase tracking-[0.14em] text-ink3 mb-1">Umbral cash-out con autorización de manager (céntimos)</label>
            <input value={cashOutThreshold} onChange={(e) => setCashOutThreshold(e.target.value)} placeholder="10000" type="number" min="0" className="input w-full font-mono text-[13px]" />
            <p className="text-[12px] text-ink3 mt-1">Default de plataforma; cada tenant lo ajusta en sus settings.</p>
          </div>
        </div>

        <div>
          <label className="block text-[12px] uppercase tracking-[0.14em] text-ink3 mb-1">Pie de ticket por defecto</label>
          <textarea value={renderFooter} onChange={(e) => setRenderFooter(e.target.value)} rows={3} placeholder="Gracias por su visita" className="input w-full text-[13px]" />
        </div>

        <div className="flex justify-end">
          <button onClick={save} disabled={saving} className="btn btn-primary">{saving ? 'Guardando…' : 'Guardar'}</button>
        </div>
      </div>
    </div>
  )
}
