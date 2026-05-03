import { useEffect, useState } from 'react'
import { useApp } from '../../../shell/lib/context'
import { api } from '../../../shell/lib/api'
import ConfirmDialog from '../../../shell/lib/ConfirmDialog.jsx'

// CRUD de vídeos en la consola embebida. Mismo endpoint que la sección
// Videos del landing (`/api/aikikan/videos`); cualquier cambio aquí se
// propaga al carrusel público.
export default function VideosAdmin() {
  const { toast } = useApp()
  const [items, setItems]   = useState([])
  const [loading, setLoad]  = useState(true)
  const [error, setError]   = useState(null)
  const [open, setOpen]     = useState(false)
  const [pendingDelete, setPendingDelete] = useState(null)

  function load() {
    setLoad(true); setError(null)
    api.get('/api/aikikan/videos')
      .then((r) => setItems(Array.isArray(r) ? r : []))
      .catch((e) => setError(e.message))
      .finally(() => setLoad(false))
  }
  useEffect(load, [])

  async function confirmDelete() {
    if (!pendingDelete) return
    try { await api.delete(`/api/aikikan/videos/${pendingDelete.id}`); toast?.('Vídeo eliminado'); load() }
    catch (e) { toast?.(e.message, 'danger') }
  }

  if (loading) return <div className="p-10 text-center text-ink3">Cargando…</div>
  if (error)   return <div className="p-10 text-center text-danger">Error: {error}</div>

  return (
    <div className="p-8 max-w-5xl">
      <div className="flex items-start justify-between gap-6 mb-8">
        <div>
          <div className="text-[12px] uppercase tracking-[0.18em] text-ink3 mb-2">Negocio</div>
          <h1 className="font-display text-[44px] leading-none tracking-tight">
            <span className="italic font-normal">Vídeos</span>
          </h1>
          <p className="text-ink3 mt-3 max-w-2xl text-[14px]">
            Carrusel del landing. Cada vídeo es un YouTube ID + etiqueta + título;
            los thumbnails se generan automáticamente desde el ID.
          </p>
        </div>
        <button onClick={() => setOpen(true)} className="px-4 py-2 rounded-md bg-ink text-paper text-[13px] font-medium">
          + Nuevo vídeo
        </button>
      </div>

      {items.length === 0 ? (
        <div className="border border-line bg-paper2 rounded-xl p-10 text-center text-ink3">
          Sin vídeos publicados.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((v) => (
            <article key={v.id} className="bg-white border border-line rounded-xl shadow-card overflow-hidden">
              <div className="aspect-video bg-paper2 relative">
                <img
                  src={`https://img.youtube.com/vi/${v.youtube_id}/hqdefault.jpg`}
                  alt={v.name}
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="p-4">
                <div className="text-[11px] uppercase tracking-[0.14em] text-ink3 mb-1">{v.label || '—'}</div>
                <div className="font-medium text-[14px] text-ink mb-2">{v.name}</div>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[11px] text-ink3">{v.youtube_id}</span>
                  <button onClick={() => setPendingDelete(v)} className="text-[12px] text-danger hover:underline">Eliminar</button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {open && (
        <NewVideoModal
          onClose={() => setOpen(false)}
          onCreated={() => { setOpen(false); toast?.('Vídeo creado'); load() }}
        />
      )}
      {pendingDelete && (
        <ConfirmDialog
          title="Eliminar vídeo"
          message={`¿Eliminar el vídeo "${pendingDelete.name}"? Esta acción no se puede deshacer.`}
          confirmLabel="Eliminar"
          onConfirm={confirmDelete}
          onClose={() => setPendingDelete(null)}
        />
      )}
    </div>
  )
}

function youtubeIdFromInput(input) {
  if (!input) return ''
  const trimmed = input.trim()
  const m = trimmed.match(/(?:youtu\.be\/|v=|\/shorts\/)([\w-]{6,})/)
  return m ? m[1] : trimmed
}

function NewVideoModal({ onClose, onCreated }) {
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
      await api.post('/api/aikikan/videos', {
        youtubeId: youtubeIdFromInput(yt),
        ...(label ? { label } : {}),
        name,
      })
      onCreated()
    } catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30" onClick={onClose}>
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-pop overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="p-6 border-b border-line">
          <div className="font-display text-[22px]">Nuevo vídeo</div>
        </div>
        <form className="p-6 space-y-4" onSubmit={submit}>
          <div>
            <div className="label mb-1.5">YouTube — URL o ID</div>
            <input type="text" required className="input" value={yt} onChange={(e) => setYt(e.target.value)} placeholder="https://youtu.be/eV3c0gMxPJI · eV3c0gMxPJI" />
          </div>
          <div>
            <div className="label mb-1.5">Etiqueta (opcional)</div>
            <input type="text" maxLength={64} className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Fundador · 8º Dan Shihan · …" />
          </div>
          <div>
            <div className="label mb-1.5">Título</div>
            <input type="text" required maxLength={256} className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Morihei Ueshiba — O'Sensei" />
          </div>
          {error && <div className="bg-dangerbg border border-line rounded-lg p-3 text-[12.5px] text-danger">{error}</div>}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn btn-ghost" disabled={busy}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={busy || !yt.trim() || !name.trim()}>
              {busy ? 'Guardando…' : 'Crear'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
