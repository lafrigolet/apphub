import { useEffect } from 'react'

// Modal de confirmación reutilizable. Sustituye al `window.confirm()`
// nativo del browser (UI propia con la tipografía y paleta del portal).
//
// Props:
//   title         — encabezado del modal
//   message       — texto explicativo
//   confirmLabel  — texto del botón principal (default "Eliminar")
//   destructive   — si true, el botón usa color destructivo (default true)
//   onConfirm     — handler async; cuando termina o lanza, se cierra el modal
//   onClose       — cancelar
export default function ConfirmModal({
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
    <div className="event-modal-overlay" onClick={onClose}>
      <div className="event-modal" onClick={(e) => e.stopPropagation()}>
        <div className="event-modal-header">
          <h2>{title}</h2>
          <button className="event-modal-close" onClick={onClose} aria-label="Cerrar">×</button>
        </div>
        <div className="event-modal-body">
          {message && <p style={{ color: 'rgba(9,9,8,.7)', fontSize: '.95rem', lineHeight: 1.55 }}>{message}</p>}
          <div className="event-modal-actions">
            <button type="button" onClick={onClose} className="event-modal-btn">Cancelar</button>
            <button
              type="button"
              onClick={handleConfirm}
              className={`event-modal-btn ${destructive ? 'primary' : ''}`}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
