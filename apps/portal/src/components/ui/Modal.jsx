import { useEffect } from 'react'
import ModalPortal from './ModalPortal'

export default function Modal({ isOpen, onClose, children }) {
  useEffect(() => {
    if (!isOpen) return
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <ModalPortal>
      <div
        className="modal-overlay"
        onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
      >
        <div className="modal-box">
          {children}
        </div>
      </div>
    </ModalPortal>
  )
}
