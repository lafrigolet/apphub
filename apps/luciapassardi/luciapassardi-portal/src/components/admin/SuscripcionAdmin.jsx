import { useEffect, useState } from 'react'
import AdminBar from './AdminBar.jsx'
import { getSuscripcion, suscribir, cancelarSuscripcion } from '../../lib/studio.js'

const eur = (c, cur = 'eur') => `${((c ?? 0) / 100).toFixed(2)} ${cur.toUpperCase() === 'EUR' ? '€' : cur.toUpperCase()}`
const PERIODO_ES = { monthly: 'mensual', annual: 'anual' }
const METODO_ES = { card: 'Tarjeta', sepa: 'Domiciliación SEPA', transfer: 'Transferencia', cash: 'Efectivo' }
const STATUS_ES = {
  inactive: 'Inactiva', trial: 'Periodo de prueba', active: 'Activa',
  past_due: 'Pago pendiente', cancelled: 'Cancelada',
}
const STATUS_STYLE = {
  active: 'bg-emerald-500/15 text-emerald-700', trial: 'bg-teal-500/15 text-teal-700',
  inactive: 'bg-tinta/10 text-tinta/55', past_due: 'bg-amber-500/15 text-amber-700',
  cancelled: 'bg-red-500/15 text-red-700',
}
const isActiva = (s) => s === 'active' || s === 'trial'

export default function SuscripcionAdmin() {
  const [sub, setSub] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  function reload() {
    setLoading(true)
    getSuscripcion().then(setSub).catch((e) => setErr(e.message)).finally(() => setLoading(false))
  }

  useEffect(() => {
    // Mensaje de retorno desde Stripe Checkout.
    const p = new URLSearchParams(window.location.search)
    const st = p.get('subscription_status')
    if (st === 'success') setMsg('Pago completado. La suscripción se activará en unos segundos.')
    else if (st === 'cancel') setMsg('Has cancelado el proceso de pago. La suscripción no se ha activado.')
    if (st) window.history.replaceState({}, '', window.location.pathname)
    reload()
  }, [])

  async function onToggle() {
    setErr(''); setMsg(''); setBusy(true)
    try {
      if (isActiva(sub?.status)) {
        const updated = await cancelarSuscripcion()
        setSub(updated)
        setMsg(updated.cancelAtPeriodEnd
          ? 'La suscripción se cancelará al final del periodo en curso.'
          : 'Suscripción desactivada.')
      } else {
        const returnUrl = window.location.origin + '/admin/suscripcion'
        const r = await suscribir(returnUrl)
        const url = r?.url ?? r?.data?.url
        if (!url) throw new Error('No se recibió la URL de pago')
        window.location.href = url   // redirige a Stripe Checkout
      }
    } catch (e) {
      setErr(e.message ?? 'No se pudo actualizar la suscripción')
    } finally {
      setBusy(false)
    }
  }

  const activa = isActiva(sub?.status)
  const amount = sub?.amountCents ?? 10000
  const periodo = PERIODO_ES[sub?.period] ?? 'mensual'
  const metodo = METODO_ES[sub?.paymentMethod] ?? 'Tarjeta'

  return (
    <AdminBar active="suscripcion">
      <div className="max-w-2xl mx-auto px-5 py-10">
        <p className="eyebrow">Backoffice · Plataforma</p>
        <h1 className="display text-4xl sm:text-5xl mt-2 mb-2">Suscripción a Hulkstein</h1>
        <p className="text-tinta/60 mb-8">Gestiona tu suscripción a la plataforma. El cobro se realiza por Stripe.</p>

        {msg && <p className="text-sm text-teal-800 bg-teal-500/10 rounded-lg px-3 py-2 mb-4">{msg}</p>}
        {err && <p className="text-sm text-red-700 bg-red-500/10 rounded-lg px-3 py-2 mb-4">{err}</p>}

        {loading ? (
          <p className="text-tinta/50">Cargando…</p>
        ) : (
          <div className="card-zen p-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="eyebrow mb-1">Plan</p>
                <p className="display text-3xl">{eur(amount, sub?.currency)} <span className="text-tinta/50 text-xl">/ {periodo}</span></p>
              </div>
              <span className={`text-xs font-semibold px-3 py-1.5 rounded-full ${STATUS_STYLE[sub?.status] || 'bg-tinta/10 text-tinta/55'}`}>
                {STATUS_ES[sub?.status] || sub?.status || '—'}
              </span>
            </div>

            <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <div>
                <dt className="text-tinta/45 uppercase tracking-widest text-[11px] font-semibold">Medio de pago</dt>
                <dd className="text-tinta/85 mt-0.5">{metodo}</dd>
              </div>
              <div>
                <dt className="text-tinta/45 uppercase tracking-widest text-[11px] font-semibold">Facturación</dt>
                <dd className="text-tinta/85 mt-0.5">{sub?.billingEmail || '—'}</dd>
              </div>
              {sub?.renewsAt && (
                <div>
                  <dt className="text-tinta/45 uppercase tracking-widest text-[11px] font-semibold">Renueva</dt>
                  <dd className="text-tinta/85 mt-0.5">{new Date(sub.renewsAt).toLocaleDateString('es-ES')}</dd>
                </div>
              )}
              {sub?.cancelAtPeriodEnd && (
                <div>
                  <dt className="text-tinta/45 uppercase tracking-widest text-[11px] font-semibold">Aviso</dt>
                  <dd className="text-amber-700 mt-0.5">Se cancelará al final del periodo</dd>
                </div>
              )}
            </dl>

            {/* Switch activar / desactivar */}
            <div className="mt-7 pt-6 border-t border-tinta/10 flex items-center justify-between gap-4">
              <div>
                <p className="font-semibold text-tinta">{activa ? 'Suscripción activa' : 'Suscripción inactiva'}</p>
                <p className="text-sm text-tinta/55">{activa ? 'Desactívala para cancelar el cobro.' : 'Actívala para suscribirte por Stripe.'}</p>
              </div>
              <button
                role="switch" aria-checked={activa} disabled={busy} onClick={onToggle}
                className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${activa ? 'bg-teal-600' : 'bg-tinta/25'}`}>
                <span className={`inline-block h-5 w-5 transform rounded-full bg-crema shadow transition-transform ${activa ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>

            {!sub?.priceConfigured && !activa && (
              <p className="mt-4 text-xs text-amber-700 bg-amber-500/10 rounded-lg px-3 py-2">
                Nota: el precio de Stripe aún no está configurado por el equipo de la plataforma; al activar verás un aviso hasta que se configure.
              </p>
            )}
          </div>
        )}
      </div>
    </AdminBar>
  )
}
