// Vista de subscripción del tenant a la plataforma. Lectura desde
//   GET /api/tenants/tenants/:tenantId/subscription
// y, si la subscripción no está activa pero hay price_id configurado,
// botón "Suscribirme" que llama a
//   POST /api/tenants/tenants/:tenantId/subscribe
// para iniciar Stripe Checkout (mode=subscription, no-split).
//
// Stripe redirige a /consola?subscription_status=success|cancel.

import { useEffect, useState } from 'react'
import * as auth from '../lib/auth.js'

async function api(method, path, body) {
  const token = auth.getAccessToken()
  const res = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
  })
  if (res.status === 204) return null
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error?.message ?? res.statusText)
  return json
}

function fmtMoney(cents, currency = 'eur') {
  if (cents == null) return '—'
  return (cents / 100).toLocaleString('es-ES', {
    style: 'currency',
    currency: (currency || 'eur').toUpperCase(),
  })
}

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })
}

export default function AdminSubscription({ identity }) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [busy, setBusy]       = useState(false)
  const [notice, setNotice]   = useState(null)

  function load() {
    setLoading(true); setError(null)
    api('GET', `/api/tenants/tenants/${identity.tenantId}/subscription`)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(load, [identity.tenantId])

  // Stripe redirect handling — leemos el query string y lo limpiamos.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const status = params.get('subscription_status')
    if (status === 'success') {
      setNotice({ kind: 'success', text: 'Pago completado. Estamos sincronizando tu subscripción…' })
      // Stripe puede tardar segundos en disparar el webhook; recargamos
      // en breve para reflejar el estado actualizado.
      setTimeout(load, 2000)
    } else if (status === 'cancel') {
      setNotice({ kind: 'warn', text: 'Has cancelado el proceso de pago.' })
    }
    if (status) window.history.replaceState(null, '', window.location.pathname)
  }, [])

  async function subscribe() {
    setBusy(true); setError(null)
    try {
      const json = await api('POST', `/api/tenants/tenants/${identity.tenantId}/subscribe`, {
        returnUrl: `${window.location.origin}/consola`,
      })
      const url = json?.url ?? json?.data?.url
      if (!url) throw new Error('No se recibió URL de checkout')
      window.location.href = url
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  if (loading) return <div className="admin-loading">Cargando subscripción…</div>
  if (error)   return <div className="admin-error">Error: {error}</div>
  if (!data)   return null

  const canSubscribe = data.priceConfigured && ['inactive', 'cancelled'].includes(data.status)

  return (
    <div className="admin-section">
      <header className="admin-section-header">
        <h1 className="admin-section-title">Subscripción a la plataforma</h1>
        <p className="admin-section-subtitle">
          Aquí gestionas el contrato de tu organización con AppHub. La
          configuración del plan la define el equipo de la plataforma.
        </p>
      </header>

      {notice && (
        <div className={`admin-notice admin-notice-${notice.kind}`}>{notice.text}</div>
      )}

      {/* ── Estado actual ───────────────────────────── */}
      <section className="admin-card">
        <div className="admin-card-title">Estado actual</div>
        <dl className="admin-dl">
          <div><dt>Estado</dt><dd><span className={`admin-status admin-status-${data.status}`}>{data.status}</span></dd></div>
          <div><dt>Período</dt><dd>{data.period ?? <em>Sin contrato</em>}</dd></div>
          <div><dt>Importe</dt><dd>{fmtMoney(data.amountCents, data.currency)}{data.period ? ` / ${data.period === 'monthly' ? 'mes' : 'año'}` : ''}</dd></div>
          <div><dt>Email de facturación</dt><dd>{data.billingEmail ?? '—'}</dd></div>
          <div><dt>Inicio</dt><dd>{fmtDate(data.startedAt)}</dd></div>
          <div><dt>Próxima renovación</dt><dd>{fmtDate(data.renewsAt)}</dd></div>
          {data.cancelAtPeriodEnd && (
            <div><dt>Cancelación</dt><dd><em>Se cancelará al final del período actual</em></dd></div>
          )}
        </dl>
      </section>

      {/* ── Acción ──────────────────────────────────── */}
      <section className="admin-card admin-card-action">
        {!data.priceConfigured ? (
          <p className="admin-empty">
            Aún no hay subscripción configurada para este tenant. Contacta con
            el equipo de AppHub para que active tu plan.
          </p>
        ) : data.status === 'active' ? (
          <p className="admin-info">
            Tu subscripción está al día. Para modificarla o cancelarla,
            escribe a soporte.
          </p>
        ) : data.status === 'past_due' ? (
          <div>
            <p className="admin-warn">El último cobro ha fallado. Reintenta el pago para mantener el servicio activo.</p>
            <button className="admin-btn admin-btn-primary" onClick={subscribe} disabled={busy}>
              {busy ? 'Redirigiendo…' : 'Reintentar pago'}
            </button>
          </div>
        ) : canSubscribe ? (
          <button className="admin-btn admin-btn-primary" onClick={subscribe} disabled={busy}>
            {busy ? 'Redirigiendo…' : 'Suscribirme ahora'}
          </button>
        ) : null}
      </section>
    </div>
  )
}
