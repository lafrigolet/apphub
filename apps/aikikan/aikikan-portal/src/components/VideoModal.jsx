import { useEffect, useState } from 'react'
import { getAccessToken } from '../lib/auth.js'

// Acepta ID corto de YouTube (11 chars) o URL completa; extrae el ID.
export function youtubeIdFromInput(input) {
  if (!input) return ''
  const trimmed = input.trim()
  // youtu.be/<id>  |  v=<id>  |  /shorts/<id>  |  raw id
  const m = trimmed.match(/(?:youtu\.be\/|v=|\/shorts\/)([\w-]{6,})/)
  if (m) return m[1]
  return trimmed
}

async function createVideo(body) {
  const token = getAccessToken()
  const res = await fetch('/api/aikikan/videos', {
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

export async function deleteVideo(id) {
  const token = getAccessToken()
  const res = await fetch(`/api/aikikan/videos/${id}`, {
    method: 'DELETE',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) {
    const json = await res.json().catch(() => ({}))
    throw new Error(json.error?.message ?? res.statusText)
  }
}

export default function VideoModal({ onClose, onCreated }) {
  const [yt, setYt]       = useState('')
  const [label, setLabel] = useState('')
  const [name, setName]   = useState('')
  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      await createVideo({
        youtubeId: youtubeIdFromInput(yt),
        ...(label ? { label } : {}),
        name,
      })
      onCreated?.()
    } catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }

  return (
    <div className="event-modal-overlay" onClick={onClose}>
      <div className="event-modal" onClick={(e) => e.stopPropagation()}>
        <div className="event-modal-header">
          <h2>Nuevo vídeo</h2>
          <button className="event-modal-close" onClick={onClose} aria-label="Cerrar">×</button>
        </div>
        <form className="event-modal-body" onSubmit={submit}>
          <div className="event-modal-field">
            <label className="event-modal-label">YouTube — URL o ID</label>
            <input type="text" required className="event-modal-input" value={yt} onChange={(e) => setYt(e.target.value)} placeholder="https://youtu.be/eV3c0gMxPJI · eV3c0gMxPJI" />
          </div>
          <div className="event-modal-field">
            <label className="event-modal-label">Etiqueta (opcional)</label>
            <input type="text" maxLength={64} className="event-modal-input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Fundador · 8º Dan Shihan · …" />
          </div>
          <div className="event-modal-field">
            <label className="event-modal-label">Título</label>
            <input type="text" required maxLength={256} className="event-modal-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Morihei Ueshiba — O'Sensei" />
          </div>
          {error && <div className="event-modal-error">{error}</div>}
          <div className="event-modal-actions">
            <button type="button" onClick={onClose} className="event-modal-btn" disabled={busy}>Cancelar</button>
            <button type="submit" className="event-modal-btn primary" disabled={busy || !yt.trim() || !name.trim()}>
              {busy ? 'Guardando…' : 'Crear'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
