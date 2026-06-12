// Reusable TPV per-tenant configuration panels shared by:
//   - views/staff/TenantDetail.jsx → TabTpv (staff impersonating a tenant)
//   - (future) views/tenant/Tpv.jsx (owner/admin acting on their own tenant)
//
// The `scopeQuery` prop is appended to API URLs so staff can pass
// ?appId=&tenantId= to target a specific tenant. For tenant-side use it stays
// empty and the backend uses the JWT's tenant (see platform/tpv/src/index.js,
// same staff-impersonation pattern as splitpay).

import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { icons } from '../../lib/icons'

// Settings come back snake_case from the repo; the PUT body wants camelCase.
function adaptSettings(row = {}) {
  return {
    issuerNif:                    row.issuer_nif ?? '',
    issuerName:                   row.issuer_name ?? '',
    issuerAddress:                row.issuer_address ?? '',
    issuerPostalCode:             row.issuer_postal_code ?? '',
    issuerCity:                   row.issuer_city ?? '',
    issuerCountry:                row.issuer_country ?? 'ES',
    autoIssueSimplified:          !!row.auto_issue_simplified,
    cashOutManagerThresholdCents: row.cash_out_manager_threshold_cents ?? 10000,
    sessionAutocloseHours:        row.session_autoclose_hours ?? 16,
    convertWindowDays:            row.convert_window_days ?? 30,
    defaultSimplifiedSeriesCode:  row.default_simplified_series_code ?? 'A',
    defaultInvoiceSeriesCode:     row.default_invoice_series_code ?? 'B',
    defaultCreditNoteSeriesCode:  row.default_credit_note_series_code ?? 'R',
    receiptFooter:                row.receipt_footer ?? '',
  }
}

function SettingsPanel({ scopeQuery = '', onToast }) {
  const [form, setForm]     = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  function reload() {
    setLoading(true)
    api.get(`/api/tpv/settings${scopeQuery}`)
      .then((res) => setForm(adaptSettings(res?.data ?? {})))
      .catch((err) => { onToast?.(err.message ?? 'Error cargando settings', 'danger'); setForm(adaptSettings()) })
      .finally(() => setLoading(false))
  }

  useEffect(() => { reload() }, [scopeQuery])

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })) }

  async function save() {
    setSaving(true)
    try {
      const body = {
        issuerNif:                    form.issuerNif || undefined,
        issuerName:                   form.issuerName || undefined,
        issuerAddress:                form.issuerAddress || null,
        issuerPostalCode:             form.issuerPostalCode || null,
        issuerCity:                   form.issuerCity || null,
        issuerCountry:                form.issuerCountry || undefined,
        autoIssueSimplified:          !!form.autoIssueSimplified,
        cashOutManagerThresholdCents: Number(form.cashOutManagerThresholdCents),
        sessionAutocloseHours:        Number(form.sessionAutocloseHours),
        convertWindowDays:            Number(form.convertWindowDays),
        defaultSimplifiedSeriesCode:  form.defaultSimplifiedSeriesCode || undefined,
        defaultInvoiceSeriesCode:     form.defaultInvoiceSeriesCode || undefined,
        defaultCreditNoteSeriesCode:  form.defaultCreditNoteSeriesCode || undefined,
        receiptFooter:                form.receiptFooter || null,
      }
      await api.put(`/api/tpv/settings${scopeQuery}`, body)
      onToast?.('Settings TPV guardados')
      reload()
    } catch (err) {
      onToast?.(err.message ?? 'Error guardando', 'danger')
    } finally {
      setSaving(false)
    }
  }

  if (loading || !form) return <div className="bg-white border border-line rounded-xl shadow-card p-6 text-ink3">Cargando…</div>

  const field = (label, k, props = {}) => (
    <div>
      <div className="label mb-1.5">{label}</div>
      <input className="input" value={form[k] ?? ''} onChange={(e) => set(k, e.target.value)} {...props} />
    </div>
  )

  return (
    <div className="bg-white border border-line rounded-xl shadow-card">
      <div className="px-5 py-4 border-b border-line">
        <div className="font-display text-[20px]">Emisor fiscal y settings</div>
        <div className="text-xs text-ink3 mt-0.5">
          Datos del emisor (NIF, razón social) que se snapshotean en cada recibo, y defaults
          operativos de caja para este tenant.
        </div>
      </div>
      <div className="p-5 space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {field('NIF / CIF del emisor', 'issuerNif', { placeholder: 'B12345678' })}
          {field('Razón social', 'issuerName', { placeholder: 'Mi Empresa SL' })}
          {field('Dirección', 'issuerAddress')}
          {field('Código postal', 'issuerPostalCode')}
          {field('Ciudad', 'issuerCity')}
          {field('País (ISO-2)', 'issuerCountry', { maxLength: 2, className: 'input uppercase' })}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {field('Umbral cash-out manager (céntimos)', 'cashOutManagerThresholdCents', { type: 'number', min: 0 })}
          {field('Autocierre de caja (horas)', 'sessionAutocloseHours', { type: 'number', min: 1, max: 72 })}
          {field('Ventana conversión simpl.→factura (días)', 'convertWindowDays', { type: 'number', min: 1, max: 365 })}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {field('Serie simplificadas', 'defaultSimplifiedSeriesCode', { maxLength: 8 })}
          {field('Serie facturas', 'defaultInvoiceSeriesCode', { maxLength: 8 })}
          {field('Serie abonos', 'defaultCreditNoteSeriesCode', { maxLength: 8 })}
        </div>

        <label className="flex items-center gap-2 text-[14px] cursor-pointer">
          <input type="checkbox" checked={!!form.autoIssueSimplified} onChange={(e) => set('autoIssueSimplified', e.target.checked)} />
          Auto-emitir ticket simplificado al cobrar
        </label>

        <div>
          <div className="label mb-1.5">Pie de ticket</div>
          <textarea className="input" rows={2} value={form.receiptFooter ?? ''} onChange={(e) => set('receiptFooter', e.target.value)} placeholder="Gracias por su visita" />
        </div>

        <div className="flex justify-end">
          <button onClick={save} disabled={saving} className="btn btn-primary">{saving ? 'Guardando…' : 'Guardar'}</button>
        </div>
      </div>
    </div>
  )
}

const KIND_LABEL = { simplified: 'Simplificadas', invoice: 'Facturas', credit_note: 'Abonos' }

function SeriesPanel({ scopeQuery = '', onToast }) {
  const [series, setSeries]   = useState([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [code, setCode]       = useState('')
  const [kind, setKind]       = useState('simplified')
  const [prefix, setPrefix]   = useState('')

  function reload() {
    setLoading(true)
    api.get(`/api/tpv/series${scopeQuery}`)
      .then((res) => setSeries(res?.data ?? []))
      .catch(() => setSeries([]))
      .finally(() => setLoading(false))
  }

  useEffect(() => { reload() }, [scopeQuery])

  async function create(e) {
    e.preventDefault()
    setCreating(true)
    try {
      await api.post(`/api/tpv/series${scopeQuery}`, {
        code: code.trim(),
        kind,
        prefix: prefix.trim() || undefined,
      })
      onToast?.(`Serie ${code} creada`)
      setCode(''); setPrefix('')
      reload()
    } catch (err) {
      onToast?.(err.message ?? 'No se pudo crear la serie', 'danger')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="bg-white border border-line rounded-xl shadow-card">
      <div className="px-5 py-4 border-b border-line">
        <div className="font-display text-[20px]">Series de numeración</div>
        <div className="text-xs text-ink3 mt-0.5">Secuencias sin huecos (fiscal). El código es único por tenant.</div>
      </div>

      <table className="t">
        <thead><tr><th>Código</th><th>Tipo</th><th>Prefijo</th><th>Próximo nº</th></tr></thead>
        <tbody>
          {loading && <tr><td colSpan={4} className="text-center text-ink3 py-6">Cargando…</td></tr>}
          {!loading && series.length === 0 && (
            <tr><td colSpan={4} className="text-center text-ink3 py-6">Sin series todavía.</td></tr>
          )}
          {!loading && series.map((s) => (
            <tr key={s.id ?? s.code}>
              <td className="font-mono">{s.code}</td>
              <td>{KIND_LABEL[s.kind] ?? s.kind}</td>
              <td className="font-mono">{s.prefix || '—'}</td>
              <td className="font-mono">{s.next_number ?? s.nextNumber ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <form onSubmit={create} className="px-5 py-4 border-t border-line flex flex-wrap items-end gap-3">
        <div>
          <div className="label mb-1.5">Código</div>
          <input className="input w-28 font-mono" value={code} onChange={(e) => setCode(e.target.value)} required maxLength={8} placeholder="A" />
        </div>
        <div>
          <div className="label mb-1.5">Tipo</div>
          <select className="select" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="simplified">Simplificadas</option>
            <option value="invoice">Facturas</option>
            <option value="credit_note">Abonos</option>
          </select>
        </div>
        <div>
          <div className="label mb-1.5">Prefijo (opcional)</div>
          <input className="input w-32 font-mono" value={prefix} onChange={(e) => setPrefix(e.target.value)} maxLength={16} />
        </div>
        <button type="submit" className="btn btn-primary btn-sm" disabled={creating}>{icons.plus}{creating ? 'Creando…' : 'Crear serie'}</button>
      </form>
    </div>
  )
}

export function TpvConfigTabs({ scopeQuery = '', onToast }) {
  return (
    <div className="space-y-4">
      <SettingsPanel scopeQuery={scopeQuery} onToast={onToast} />
      <SeriesPanel scopeQuery={scopeQuery} onToast={onToast} />
    </div>
  )
}
