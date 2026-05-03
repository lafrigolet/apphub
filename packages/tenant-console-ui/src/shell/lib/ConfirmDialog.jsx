import { useEffect } from 'react'

// Modal de confirmación para acciones destructivas dentro de la consola.
// Sustituye `window.confirm()` por una UI consistente con el shell.
export default function ConfirmDialog({
  title = 'Confirmar acción',
  message,
  confirmLabel = 'Eliminar',
  destructive = true,
  onConfirm,
  onClose,
}) {
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function handleConfirm() {
    try { await onConfirm?.() } finally { onClose?.() }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-white rounded-2xl shadow-pop overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b border-line">
          <div className="font-display text-[20px] tracking-tight">{title}</div>
        </div>
        <div className="p-5">
          {message && <p className="text-[13.5px] text-ink2 leading-relaxed">{message}</p>}
          <div className="flex items-center justify-end gap-2 mt-5">
            <button onClick={onClose} className="px-3 py-2 rounded-md text-[13px] text-ink2 border border-line hover:bg-paper2">
              Cancelar
            </button>
            <button
              onClick={handleConfirm}
              className={`px-3 py-2 rounded-md text-[13px] font-medium ${
                destructive
                  ? 'bg-danger text-white hover:bg-danger/90'
                  : 'bg-ink text-paper hover:bg-ink/90'
              }`}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
