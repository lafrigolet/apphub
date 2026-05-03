import { useEffect, useState } from 'react'
import { getAccessToken } from '../lib/auth.js'

async function createDojo(body) {
  const token = getAccessToken()
  const res = await fetch('/api/aikikan/dojos', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error?.message ?? res.statusText)
  return json
}

export async function deleteDojo(id) {
  const token = getAccessToken()
  const res = await fetch(`/api/aikikan/dojos/${id}`, {
    method: 'DELETE',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) {
    const json = await res.json().catch(() => ({}))
    throw new Error(json.error?.message ?? res.statusText)
  }
}

export default function DojoModal({ onClose, onCreated }) {
  const [form, setForm] = useState({
    name: '', city: '', province: '',
    address: '', sensei: '', phone: '', email: '', web: '',
  })
  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState(null)

  function setField(k, v) { setForm((f) => ({ ...f, [k]: v })) }

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      // El server usa Zod con .optional() — no pasamos campos vacíos.
      const body = Object.fromEntries(
        Object.entries(form).filter(([, v]) => v && v.trim?.() !== ''),
      )
      await createDojo(body)
      onCreated?.()
    } catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }

  const canSubmit = form.name.trim() && form.city.trim() && form.province.trim()

  return (
    <div className="event-modal-overlay" onClick={onClose}>
      <div className="event-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
        <div className="event-modal-header">
          <h2>Nuevo dojo</h2>
          <button className="event-modal-close" onClick={onClose} aria-label="Cerrar">×</button>
        </div>
        <form className="event-modal-body" onSubmit={submit}>
          <div className="event-modal-field">
            <label className="event-modal-label">Nombre *</label>
            <input type="text" required maxLength={128} className="event-modal-input" value={form.name} onChange={(e) => setField('name', e.target.value)} placeholder="Aikikan Castellón" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.75rem' }}>
            <div className="event-modal-field">
              <label className="event-modal-label">Ciudad *</label>
              <input type="text" required maxLength={128} className="event-modal-input" value={form.city} onChange={(e) => setField('city', e.target.value)} />
            </div>
            <div className="event-modal-field">
              <label className="event-modal-label">Provincia *</label>
              <input type="text" required maxLength={128} className="event-modal-input" value={form.province} onChange={(e) => setField('province', e.target.value)} />
            </div>
          </div>
          <div className="event-modal-field">
            <label className="event-modal-label">Dirección</label>
            <input type="text" maxLength={256} className="event-modal-input" value={form.address} onChange={(e) => setField('address', e.target.value)} placeholder="C/ Ejemplo 1, 28000" />
          </div>
          <div className="event-modal-field">
            <label className="event-modal-label">Sensei</label>
            <input type="text" maxLength={256} className="event-modal-input" value={form.sensei} onChange={(e) => setField('sensei', e.target.value)} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.75rem' }}>
            <div className="event-modal-field">
              <label className="event-modal-label">Teléfono</label>
              <input type="tel" maxLength={64} className="event-modal-input" value={form.phone} onChange={(e) => setField('phone', e.target.value)} placeholder="600 000 000" />
            </div>
            <div className="event-modal-field">
              <label className="event-modal-label">Email</label>
              <input type="email" maxLength={256} className="event-modal-input" value={form.email} onChange={(e) => setField('email', e.target.value)} placeholder="dojo@ejemplo.com" />
            </div>
          </div>
          <div className="event-modal-field">
            <label className="event-modal-label">Web (sin https://)</label>
            <input type="text" maxLength={256} className="event-modal-input" value={form.web} onChange={(e) => setField('web', e.target.value)} placeholder="dojo.com" />
          </div>
          {error && <div className="event-modal-error">{error}</div>}
          <div className="event-modal-actions">
            <button type="button" onClick={onClose} className="event-modal-btn" disabled={busy}>Cancelar</button>
            <button type="submit" className="event-modal-btn primary" disabled={busy || !canSubmit}>
              {busy ? 'Guardando…' : 'Crear'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
