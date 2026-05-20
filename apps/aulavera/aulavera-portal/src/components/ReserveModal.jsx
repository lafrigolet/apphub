import { useState } from 'react'
import { useToast } from './Toast'
import { leads } from '../lib/api'

export default function ReserveModal({ item, onClose }) {
  const showToast = useToast()
  const [submitting, setSubmitting] = useState(false)

  if (!item) return null
  const priceLabel = (item.price_label ?? item.price ?? '').replace('Reservar (', '').replace(')', '')

  const onBackdropClick = (e) => {
    if (e.target === e.currentTarget) onClose()
  }

  const onSubmit = async (e) => {
    e.preventDefault()
    const form = e.currentTarget
    const data = new FormData(form)
    setSubmitting(true)
    try {
      await leads.create({
        contactName: data.get('name'),
        email:       data.get('email'),
        message:     `Reserva: ${item.title} (${item.when_text ?? item.when ?? ''})\nSeñal: ${priceLabel}\nPreferencias: ${data.get('notes') ?? ''}`.trim(),
        source:      'aulavera/reserva',
      })
      onClose()
      showToast('Reserva enviada 🌿 Te confirmamos por email en 48 h.')
    } catch (err) {
      showToast(`No se pudo enviar la reserva: ${err.message}`)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onBackdropClick}>
      <div className="modal">
        <button className="close" onClick={onClose}>×</button>
        <span className="when">{item.when_text ?? item.when}</span>
        <h3>{item.title}</h3>
        <p style={{ color: 'var(--ink-soft)', marginBottom: 20 }}>
          Reserva tu plaza. La señal solo se reembolsa si anulas con al menos 7 días de antelación.
        </p>
        <div className="price-row">
          <span className="lab">Señal de reserva</span>
          <span className="val">{priceLabel}</span>
        </div>
        <form className="form" onSubmit={onSubmit}>
          <div className="form-row">
            <div className="field"><label>Nombre</label><input name="name" type="text" required /></div>
            <div className="field"><label>Email</label><input name="email" type="email" required /></div>
          </div>
          <div className="field">
            <label>Preferencias de alojamiento <span style={{ color: 'var(--ink-mute)' }}>(opcional)</span></label>
            <textarea name="notes" placeholder="Habitación compartida / individual, accesibilidad, alergias…" />
          </div>
          <label className="check">
            <input type="checkbox" required />
            <span>Acepto la política de cancelación y el tratamiento de datos.</span>
          </label>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Enviando…' : 'Reservar →'}
          </button>
        </form>
      </div>
    </div>
  )
}
