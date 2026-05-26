import { useEffect, useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { api } from '../../lib/api.js'

const STATUSES = ['new', 'contacted', 'closed', 'spam']

export default function InquiryDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [inquiry, setInquiry] = useState(null)
  const [status, setStatus]   = useState('new')
  const [notes, setNotes]     = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [saving, setSaving]   = useState(false)
  const [toastMsg, setToastMsg] = useState('')

  useEffect(() => {
    setLoading(true)
    api('GET', `/api/inquiries/admin/${id}`)
      .then((j) => {
        const r = j.data ?? j
        setInquiry(r)
        setStatus(r.status)
        setNotes(r.staff_notes ?? r.staffNotes ?? '')
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [id])

  async function onSave() {
    setSaving(true)
    setError('')
    try {
      await api('PATCH', `/api/inquiries/admin/${id}`, {
        status,
        staffNotes: notes,
      })
      setToastMsg('Cambios guardados')
      setTimeout(() => setToastMsg(''), 2500)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p className="text-ink-700/60">Cargando…</p>
  if (error && !inquiry) return <p className="text-red-700">{error}</p>
  if (!inquiry) return null

  const created = inquiry.created_at ?? inquiry.createdAt
  const meta    = inquiry.metadata ?? {}
  const source  = inquiry.source ?? '—'
  const ref     = inquiry.reference ?? inquiry.id
  const sim     = meta.kind === 'budget' ? meta.simulation : null

  return (
    <div>
      <Link to="/admin/inquiries" className="text-sm text-ink-700 hover:text-ink-900 transition">← Volver al listado</Link>

      {sim && <SimulationPanel sim={sim} />}

      <div className="grid lg:grid-cols-3 gap-6 mt-4">
        <div className="lg:col-span-2 bg-white rounded-2xl border border-ink-900/5 shadow-soft p-7">
          <div className="flex items-start justify-between mb-6">
            <div>
              <div className="text-xs uppercase tracking-wider text-ink-700/60 mb-1">Inquiry · {ref}</div>
              <h1 className="font-display text-2xl font-semibold">{inquiry.contact_name ?? inquiry.contactName}</h1>
              <div className="text-sm text-ink-700 mt-1">{inquiry.email}{inquiry.phone ? ` · ${inquiry.phone}` : ''}</div>
            </div>
            <div className="text-xs text-ink-700/60 font-mono">{formatDate(created)}</div>
          </div>

          <Field label="Servicio">{inquiry.subject ?? '—'}</Field>
          <Field label="Origen">{source}</Field>
          <Field label="Mensaje">
            <p className="whitespace-pre-wrap leading-relaxed">{inquiry.message}</p>
          </Field>
          {Object.keys(meta).length > 0 && !sim && (
            <Field label="Metadata">
              <pre className="text-xs bg-bone/60 border border-ink-900/5 rounded-lg p-3 overflow-x-auto">{JSON.stringify(meta, null, 2)}</pre>
            </Field>
          )}
        </div>

        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-ink-900/5 shadow-soft p-6">
            <h2 className="font-display font-semibold mb-4">Gestión</h2>
            <label className="block text-xs font-medium text-ink-700 mb-1.5">Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg border border-ink-900/10 bg-bone/50 text-sm mb-4">
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>

            <label className="block text-xs font-medium text-ink-700 mb-1.5">Notas internas</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={6}
              className="field w-full px-3 py-2.5 rounded-lg border border-ink-900/10 bg-bone/50 text-sm resize-none mb-4"
              placeholder="Llamado, presupuesto enviado, etc." />

            {error && (
              <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">{error}</div>
            )}
            {toastMsg && (
              <div className="text-xs text-electric-700 bg-electric-50 border border-electric-200 rounded-lg px-3 py-2 mb-3">{toastMsg}</div>
            )}

            <button onClick={onSave} disabled={saving}
              className="btn-primary w-full inline-flex items-center justify-center gap-2 bg-ink-900 text-white px-5 py-3 rounded-full font-medium text-sm shadow-lift disabled:opacity-60 disabled:cursor-not-allowed">
              {saving ? 'Guardando…' : 'Guardar cambios'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function SimulationPanel({ sim }) {
  // Formato es-ES con coma decimal, igual que la calculadora del landing.
  const fmt = (n, d = 0) => Number(n ?? 0).toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d })
  const inputs = [
    sim.facturaMensual != null && `factura ${fmt(sim.facturaMensual)}€/mes`,
    sim.area          != null && `área ${fmt(sim.area)} m²`,
    sim.tipo,
    sim.orientacion && `orientación ${sim.orientacion}`,
  ].filter(Boolean).join(' · ')

  return (
    <div className="bg-ink-900 text-white rounded-2xl shadow-soft p-6 sm:p-7 grid-bg relative overflow-hidden mt-4">
      <div className="absolute -right-12 -top-12 w-44 h-44 rounded-full bg-electric-500/30 blur-3xl pointer-events-none"></div>
      <div className="relative">
        <div className="flex items-baseline justify-between mb-5">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-electric-300 mb-1">Simulación solar enviada por el visitante</div>
            <h2 className="font-display text-xl font-semibold">Snapshot de la calculadora</h2>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
          <Kpi label="Potencia" value={`${fmt(sim.potencia, 1)} kWp`} />
          <Kpi label="Ahorro / año" value={`${fmt(sim.ahorroAnual)} €`} accent />
          <Kpi label="Amortización" value={`${fmt(sim.roi, 1)} años`} />
          <Kpi label="CO₂ evitado" value={`${fmt(sim.co2, 1)} t/año`} />
        </div>
        <div className="text-xs text-white/70 mb-1">Inversión estimada</div>
        <div className="font-display text-2xl font-semibold tracking-tight mb-3">{fmt(sim.coste)} €</div>
        <div className="text-xs text-white/60">Inputs: {inputs || '—'}</div>
      </div>
    </div>
  )
}

function Kpi({ label, value, accent = false }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-white/50 mb-1.5">{label}</div>
      <div className={`font-display text-2xl sm:text-3xl font-semibold ${accent ? 'text-electric-300' : 'text-white'}`}>{value}</div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div className="mb-5">
      <div className="text-[10px] uppercase tracking-widest text-ink-700/60 mb-1.5">{label}</div>
      <div className="text-sm text-ink-900">{children}</div>
    </div>
  )
}

function formatDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
