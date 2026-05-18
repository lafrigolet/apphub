// Consola admin para editar el catálogo de cuotas (fee_products) del
// portal del socio. Los 3 productos seed (matricula, seguro, anual) son
// fijos — el admin sólo puede editar nombre, descripción, importe y
// stripe_price_id. code, kind, currency e interval_months quedan
// bloqueados (cambios disruptivos para Stripe / históricos).
//
// Endpoint público para leer:
//   GET /api/aikikan/fees/products
// Endpoint admin para escribir (introducido para esta vista):
//   PATCH /api/aikikan/fees/products/:code  { name?, description?, amountCents?, stripePriceId? }

import { useEffect, useState } from 'react'
import { getIdentity } from '../../lib/auth.js'
import { api } from '../../lib/api.js'

function kindLabel(kind) {
  if (kind === 'recurring_annual') return 'Suscripción anual'
  if (kind === 'one_shot')         return 'Pago único'
  return kind
}

// amount_cents ⇄ display "35,00" — usamos el `step="0.01"` del input
// number y el separador del locale del navegador. La conversión a/desde
// cents es lo que viaja al backend.
function centsToEuros(cents) {
  return ((cents ?? 0) / 100).toFixed(2)
}
function eurosToCents(str) {
  const n = Number(String(str).replace(',', '.'))
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 100)
}

export default function BillingAdmin() {
  const identity = getIdentity()
  const [products, setProducts] = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)

  function load() {
    setLoading(true); setError(null)
    api('GET', '/api/aikikan/fees/products')
      .then((arr) => setProducts(Array.isArray(arr) ? arr : []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  if (!identity || !['owner', 'admin'].includes(identity.role)) {
    return <div className="admin-error">Acceso restringido a owner/admin.</div>
  }

  return (
    <div style={{ maxWidth: 920 }}>
      <div className="admin-section-header" style={{ marginBottom: '1.5rem' }}>
        <h1 className="admin-section-title">Billing</h1>
        <p className="admin-section-subtitle">
          Cuotas que ven los socios en su portal. Edita nombre, descripción,
          importe o stripe_price_id. El <span style={{ fontFamily: 'monospace' }}>stripe_price_id</span> se
          obtiene del dashboard de Stripe.
        </p>
      </div>

      {loading && <p className="admin-loading">Cargando productos…</p>}
      {error   && <p className="admin-error">Error: {error}</p>}

      {!loading && !error && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {products.map((p) => (
            <ProductCard key={p.code} product={p} onSaved={load} />
          ))}
          {products.length === 0 && (
            <p className="admin-empty">Sin productos en el catálogo.</p>
          )}
        </div>
      )}
    </div>
  )
}

function ProductCard({ product, onSaved }) {
  const [form, setForm] = useState({
    name:          product.name ?? '',
    description:   product.description ?? '',
    amountEuros:   centsToEuros(product.amount_cents),
    stripePriceId: product.stripe_price_id ?? '',
  })
  const [busy, setBusy]     = useState(false)
  const [error, setError]   = useState(null)
  const [notice, setNotice] = useState(null)

  // Diff vs estado inicial — solo enviamos los campos que cambiaron.
  function buildPatch() {
    const out = {}
    if (form.name.trim() !== (product.name ?? '')) {
      out.name = form.name.trim()
    }
    if (form.description.trim() !== (product.description ?? '')) {
      out.description = form.description.trim() || null
    }
    const newCents = eurosToCents(form.amountEuros)
    if (newCents !== product.amount_cents) {
      if (newCents == null) throw new Error('Importe inválido')
      out.amountCents = newCents
    }
    const newPrice = form.stripePriceId.trim() || null
    const oldPrice = product.stripe_price_id ?? null
    if (newPrice !== oldPrice) {
      out.stripePriceId = newPrice
    }
    return out
  }

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setError(null); setNotice(null)
    try {
      const patch = buildPatch()
      if (Object.keys(patch).length === 0) {
        setNotice('Sin cambios.')
        return
      }
      await api('PATCH', `/api/aikikan/fees/products/${product.code}`, patch)
      setNotice('Guardado.')
      onSaved?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="admin-card">
      <div className="admin-card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontFamily: 'monospace', textTransform: 'none', letterSpacing: 0, fontSize: '.9rem', color: '#0a0908' }}>
          {product.code}
        </span>
        <span className="admin-status admin-status-inactive">{kindLabel(product.kind)}</span>
      </div>

      <div className="user-form-grid">
        <label className="user-field">
          <span className="user-field-label">Nombre</span>
          <input
            type="text"
            required
            maxLength={256}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </label>
        <label className="user-field">
          <span className="user-field-label">Importe (€)</span>
          <input
            type="number"
            min="0"
            step="0.01"
            required
            value={form.amountEuros}
            onChange={(e) => setForm({ ...form, amountEuros: e.target.value })}
          />
        </label>
      </div>

      <label className="user-field" style={{ marginTop: '1rem' }}>
        <span className="user-field-label">Descripción</span>
        <textarea
          rows={3}
          maxLength={2048}
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
      </label>

      <label className="user-field" style={{ marginTop: '1rem' }}>
        <span className="user-field-label">stripe_price_id</span>
        <input
          type="text"
          maxLength={256}
          placeholder="price_xxxxxxxxxxxxx"
          value={form.stripePriceId}
          onChange={(e) => setForm({ ...form, stripePriceId: e.target.value })}
          style={{ fontFamily: 'monospace', fontSize: '.85rem' }}
        />
      </label>

      {error  && <p className="admin-error"  style={{ marginTop: '1rem', padding: '.5rem 0' }}>{error}</p>}
      {notice && <p className="admin-notice admin-notice-success" style={{ marginTop: '1rem' }}>{notice}</p>}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
        <button type="submit" className="admin-btn admin-btn-primary" disabled={busy}>
          {busy ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </div>
    </form>
  )
}
