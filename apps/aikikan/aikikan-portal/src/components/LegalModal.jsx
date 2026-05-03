import { useEffect } from 'react'

// Modal genérico para contenido legal. Recibe un título y JSX/texto a
// renderizar dentro. Usa los estilos `.legal-modal-*` definidos en
// landing.css — paleta del landing (paper / accent) y tipografía
// Cormorant para texto fluido + Bebas para encabezados.
export default function LegalModal({ title, children, onClose }) {
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Bloquear scroll del body mientras el modal está abierto.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  return (
    <div className="legal-modal-overlay" onClick={onClose}>
      <div className="legal-modal" onClick={(e) => e.stopPropagation()}>
        <div className="legal-modal-header">
          <h2>{title}</h2>
          <button className="legal-modal-close" onClick={onClose} aria-label="Cerrar">×</button>
        </div>
        <div className="legal-modal-body">
          {children}
        </div>
      </div>
    </div>
  )
}
