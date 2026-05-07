// Form de configuración de la subscripción tenant↔plataforma. Editable
// por staff/super_admin (el writeGuard del backend lo garantiza). Los
// campos `subscriptionStripe*Id` son de solo lectura — los rellena el
// subscriber de eventos splitpay tras el primer pago.

import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { fmtDate } from '../../lib/utils'

const SUB_STATUSES = ['inactive', 'trial', 'active', 'past_due', 'cancelled']
const SUB_PERIODS  = ['monthly', 'annual']

function StatusPill({ status }) {
  const cls =
    status === 'active'    ? 'bg-okbg text-ok' :
    status === 'trial'     ? 'bg-infobg text-info' :
    status === 'past_due'  ? 'bg-warnbg text-warn' :
    status === 'cancelled' ? 'bg-dangerbg text-danger' :
                              'bg-paper2 text-ink3'
  return <span className={`badge ${cls}`}>{status}</span>
}

function toIsoDateInput(iso) {
  if (!iso) return ''
  return new Date(iso).toISOString().slice(0, 10)
}
function fromDateInputToIso(d) {
  if (!d) return null
  return new Date(`${d}T00:00:00Z`).toISOString()
}

export default function SubscriptionPanel({ tenant, onSaved, onToast }) {
  const sub = tenant.subscription ?? {}

  const [period,            setPeriod]            = useState(sub.period ?? '')
  const [status,            setStatus]            = useState(sub.status ?? 'inactive')
  const [amountEur,         setAmountEur]         = useState(sub.amountCents != null ? (sub.amountCents / 100).toFixed(2) : '')
  const [currency,          setCurrency]          = useState((sub.currency ?? 'eur').toUpperCase())
  const [stripePriceId,     setStripePriceId]     = useState(sub.stripePriceId ?? '')
  const [billingEmail,      setBillingEmail]      = useState(sub.billingEmail ?? '')
  const [startedAt,         setStartedAt]         = useState(toIsoDateInput(sub.startedAt))
  const [renewsAt,          setRenewsAt]          = useState(toIsoDateInput(sub.renewsAt))
  const [cancelAtPeriodEnd, setCancelAtPeriodEnd] = useState(!!sub.cancelAtPeriodEnd)
  const [notes,             setNotes]             = useState(sub.notes ?? '')
  const [saving,            setSaving]            = useState(false)
  const [error,             setError]             = useState(null)

  useEffect(() => {
    const s = tenant.subscription ?? {}
    setPeriod(s.period ?? '')
    setStatus(s.status ?? 'inactive')
    setAmountEur(s.amountCents != null ? (s.amountCents / 100).toFixed(2) : '')
    setCurrency((s.currency ?? 'eur').toUpperCase())
    setStripePriceId(s.stripePriceId ?? '')
    setBillingEmail(s.billingEmail ?? '')
    setStartedAt(toIsoDateInput(s.startedAt))
    setRenewsAt(toIsoDateInput(s.renewsAt))
    setCancelAtPeriodEnd(!!s.cancelAtPeriodEnd)
    setNotes(s.notes ?? '')
  }, [tenant.id])

  async function save(e) {
    e.preventDefault()
    setSaving(true); setError(null)
    try {
      const body = {
        subscriptionPeriod:           period || null,
        subscriptionStatus:           status,
        subscriptionAmountCents:      amountEur === '' ? null : Math.round(Number(amountEur) * 100),
        subscriptionCurrency:         (currency || 'eur').toLowerCase(),
        subscriptionStripePriceId:    stripePriceId.trim() || null,
        subscriptionBillingEmail:     billingEmail.trim() || null,
        subscriptionStartedAt:        fromDateInputToIso(startedAt),
        subscriptionRenewsAt:         fromDateInputToIso(renewsAt),
        subscriptionCancelAtPeriodEnd: cancelAtPeriodEnd,
        subscriptionNotes:            notes.trim() || null,
      }
      await api.patch(`/api/tenants/tenants/${tenant.id}`, body)
      onToast?.('Subscripción actualizada')
      onSaved?.()
    } catch (err) {
      setError(err.message ?? 'No se pudo guardar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={save} className="bg-white border border-line rounded-xl shadow-card">
      <div className="px-5 py-4 border-b border-line flex items-center justify-between">
        <div>
          <div className="font-display text-[20px]">Subscripción a la plataforma</div>
          <div className="text-xs text-ink3 mt-0.5">
            Parametriza el cobro recurrente del tenant a AppHub. El cobro real
            lo ejecuta Stripe via splitpay (modo subscription, no-split).
          </div>
        </div>
        <StatusPill status={status} />
      </div>

      <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-5">
        <label className="block">
          <span className="text-[12px] uppercase tracking-[0.14em] text-ink3">Estado</span>
          <select className="mt-1 input" value={status} onChange={(e) => setStatus(e.target.value)}>
            {SUB_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>

        <label className="block">
          <span className="text-[12px] uppercase tracking-[0.14em] text-ink3">Período</span>
          <select className="mt-1 input" value={period} onChange={(e) => setPeriod(e.target.value)}>
            <option value="">Sin contrato</option>
            {SUB_PERIODS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>

        <label className="block">
          <span className="text-[12px] uppercase tracking-[0.14em] text-ink3">Importe</span>
          <div className="flex items-center gap-2 mt-1">
            <input type="number" min="0" step="0.01" className="input flex-1"
                   value={amountEur} onChange={(e) => setAmountEur(e.target.value)} placeholder="0.00" />
            <input type="text" maxLength={3} className="input w-20"
                   value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
          </div>
        </label>

        <label className="block">
          <span className="text-[12px] uppercase tracking-[0.14em] text-ink3">Stripe price_id</span>
          <input type="text" className="mt-1 input font-mono"
                 value={stripePriceId} onChange={(e) => setStripePriceId(e.target.value)}
                 placeholder="price_…" />
          {!stripePriceId && (
            <span className="text-[11.5px] text-warn mt-0.5 block">
              Sin price_id el tenant no puede iniciar el checkout.
            </span>
          )}
        </label>

        <label className="block">
          <span className="text-[12px] uppercase tracking-[0.14em] text-ink3">Email de facturación</span>
          <input type="email" className="mt-1 input"
                 value={billingEmail} onChange={(e) => setBillingEmail(e.target.value)}
                 placeholder="billing@tenant.com" />
        </label>

        <label className="flex items-center gap-2 mt-7">
          <input type="checkbox" checked={cancelAtPeriodEnd}
                 onChange={(e) => setCancelAtPeriodEnd(e.target.checked)} />
          <span className="text-[13px]">Cancelar al final del período actual</span>
        </label>

        <label className="block">
          <span className="text-[12px] uppercase tracking-[0.14em] text-ink3">Inicio</span>
          <input type="date" className="mt-1 input"
                 value={startedAt} onChange={(e) => setStartedAt(e.target.value)} />
        </label>

        <label className="block">
          <span className="text-[12px] uppercase tracking-[0.14em] text-ink3">Próxima renovación</span>
          <input type="date" className="mt-1 input"
                 value={renewsAt} onChange={(e) => setRenewsAt(e.target.value)} />
        </label>

        <label className="block md:col-span-2">
          <span className="text-[12px] uppercase tracking-[0.14em] text-ink3">Notas</span>
          <textarea rows={3} className="mt-1 input"
                    value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </div>

      <div className="px-5 py-3 border-t border-line bg-paper2/30 flex items-center justify-between">
        <div className="text-[12px] text-ink3">
          {sub.stripeSubscriptionId
            ? <>Stripe sub: <span className="font-mono">{sub.stripeSubscriptionId}</span></>
            : 'Stripe aún no enlazado'}
          {sub.renewsAt && <> · Próxima renovación: {fmtDate(sub.renewsAt)}</>}
        </div>
        <div className="flex items-center gap-3">
          {error && <span className="text-[12px] text-danger">{error}</span>}
          <button type="submit" disabled={saving} className="btn btn-primary btn-sm">
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </form>
  )
}
