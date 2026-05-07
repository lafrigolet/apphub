import { useEffect, useState } from 'react'
import { getAccessToken } from '../lib/auth.js'

// Estado y pagos de cuotas. El componente consume:
//   GET /api/aikikan/fees/me        — historial + estado del socio
//   GET /api/aikikan/fees/products  — catálogo (público)
//   POST /api/aikikan/fees/checkout — Stripe Checkout Session URL
// El click en cada botón redirige a Stripe Checkout (hosted). Tras pagar
// Stripe vuelve a `/area-socio?fees_status=success&session_id=...` y el
// efecto de carga refresca el estado.

async function api(method, path, body) {
  const token = getAccessToken()
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
  return (cents / 100).toLocaleString('es-ES', { style: 'currency', currency: currency.toUpperCase() })
}

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })
}

export default function MemberFees({ onBack }) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [busy, setBusy]       = useState(null)        // qué botón está esperando redirect

  function load() {
    setLoading(true); setError(null)
    api('GET', '/api/aikikan/fees/me')
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  async function startCheckout(codes, label) {
    setBusy(label); setError(null)
    try {
      const { url } = await api('POST', '/api/aikikan/fees/checkout', {
        codes,
        returnPath: '/area-socio',
      })
      // Hard-redirect a Stripe Checkout. Stripe nos devuelve a returnPath
      // tras el pago (success o cancel) — App.jsx detecta el query string
      // y muestra un mensaje.
      window.location.href = url
    } catch (err) {
      setError(err.message)
      setBusy(null)
    }
  }

  if (loading) return <div className="member-profile-loading">Cargando…</div>
  if (error)   return <div className="member-profile-error">Error: {error}</div>
  if (!data)   return null

  const { products, status, subscription, payments } = data
  const matricula = products.find((p) => p.code === 'matricula')
  const seguro    = products.find((p) => p.code === 'seguro')
  const anual     = products.find((p) => p.code === 'anual')

  return (
    <main className="member-home">
      <header className="member-home-nav">
        <div className="member-home-logo">AIKIKAN<span> /</span> CUOTAS</div>
        <button className="member-home-logout" onClick={onBack}>← Volver</button>
      </header>

      <section className="member-home-hero">
        <p className="member-home-eyebrow"><span className="slash">/</span> Cuotas y pagos</p>
        <h1 className="member-home-title">
          <span className="italic font-normal">Tus cuotas</span>
        </h1>
        <p className="member-home-lead">
          Paga la matrícula, el seguro de práctica deportiva, ambas a la vez, o
          suscríbete anualmente para que se renueven en automático.
        </p>
      </section>

      {/* ── Estado actual ────────────────────────────────────── */}
      <section className="member-profile-card">
        <div className="member-profile-section-title">Estado actual</div>
        <dl className="member-profile-dl">
          <div>
            <dt>Matrícula</dt>
            <dd>{status.matricula?.paid
              ? <>✓ Al día <span style={{ color: 'rgba(9,9,8,.55)', fontSize: '.85rem' }}>· {fmtDate(status.matricula.paidAt)}</span></>
              : <em>Pendiente de pago</em>}</dd>
          </div>
          <div>
            <dt>Seguro</dt>
            <dd>{status.seguro?.paid
              ? <>✓ Al día <span style={{ color: 'rgba(9,9,8,.55)', fontSize: '.85rem' }}>· {fmtDate(status.seguro.paidAt)}</span></>
              : <em>Pendiente de pago</em>}</dd>
          </div>
          <div>
            <dt>Suscripción anual</dt>
            <dd>{subscription?.status === 'active'
              ? <>✓ Activa <span style={{ color: 'rgba(9,9,8,.55)', fontSize: '.85rem' }}>· renovación {fmtDate(subscription.current_period_end)}</span></>
              : subscription?.status === 'past_due' ? <em style={{ color: 'var(--accent)' }}>Pago pendiente</em>
              : subscription?.status === 'cancelled' ? <em>Cancelada</em>
              : <em>Sin suscripción</em>}</dd>
          </div>
        </dl>
      </section>

      {/* ── Acciones de pago ─────────────────────────────────── */}
      <section className="member-profile-card member-profile-card-spacer">
        <div className="member-profile-section-title">Pagar ahora</div>

        <div className="fee-grid">
          <article className="fee-card">
            <h3>{matricula.name}</h3>
            <p>{matricula.description}</p>
            <div className="fee-amount">{fmtMoney(matricula.amount_cents, matricula.currency)}</div>
            <button
              className="member-home-logout member-profile-primary"
              onClick={() => startCheckout(['matricula'], 'matricula')}
              disabled={busy != null || status.matricula?.paid}
            >
              {busy === 'matricula' ? 'Redirigiendo…' : status.matricula?.paid ? 'Ya pagada' : 'Pagar matrícula'}
            </button>
          </article>

          <article className="fee-card">
            <h3>{seguro.name}</h3>
            <p>{seguro.description}</p>
            <div className="fee-amount">{fmtMoney(seguro.amount_cents, seguro.currency)}</div>
            <button
              className="member-home-logout member-profile-primary"
              onClick={() => startCheckout(['seguro'], 'seguro')}
              disabled={busy != null || status.seguro?.paid}
            >
              {busy === 'seguro' ? 'Redirigiendo…' : status.seguro?.paid ? 'Ya pagado' : 'Pagar seguro'}
            </button>
          </article>

          <article className="fee-card">
            <h3>Matrícula + Seguro</h3>
            <p>Paga ambas cuotas en una sola operación.</p>
            <div className="fee-amount">{fmtMoney(matricula.amount_cents + seguro.amount_cents, matricula.currency)}</div>
            <button
              className="member-home-logout member-profile-primary"
              onClick={() => startCheckout(['matricula', 'seguro'], 'ambas')}
              disabled={busy != null || (status.matricula?.paid && status.seguro?.paid)}
            >
              {busy === 'ambas' ? 'Redirigiendo…' : 'Pagar ambas'}
            </button>
          </article>

          <article className="fee-card fee-card-recommended">
            <span className="fee-badge">Recomendado</span>
            <h3>{anual.name}</h3>
            <p>{anual.description}</p>
            <div className="fee-amount">{fmtMoney(anual.amount_cents, anual.currency)}<span className="fee-period">/año</span></div>
            <button
              className="member-home-logout member-profile-primary"
              onClick={() => startCheckout(['anual'], 'anual')}
              disabled={busy != null || subscription?.status === 'active'}
            >
              {busy === 'anual' ? 'Redirigiendo…' :
               subscription?.status === 'active' ? 'Ya suscrito' :
               'Suscribirme'}
            </button>
          </article>
        </div>
      </section>

      {/* ── Historial ────────────────────────────────────────── */}
      <section className="member-profile-card member-profile-card-spacer">
        <div className="member-profile-section-title">Historial</div>
        {payments.length === 0 ? (
          <p style={{ color: 'rgba(9,9,8,.55)' }}>Sin movimientos.</p>
        ) : (
          <table className="fee-history">
            <thead>
              <tr><th>Fecha</th><th>Concepto</th><th>Importe</th><th>Estado</th></tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td>{fmtDate(p.paid_at ?? p.created_at)}</td>
                  <td>{p.product_codes.join(' + ')}</td>
                  <td>{fmtMoney(p.amount_cents, p.currency)}</td>
                  <td><span className={`fee-status fee-status-${p.status}`}>{p.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  )
}
