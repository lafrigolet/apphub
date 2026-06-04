import { useRef, useState } from 'react'
import { useToast } from '../Toast'
import { leads } from '../../lib/api'
import { curso } from '../../data/grafocaligrafia/curso'

// Inscripción al curso profesional — REUSE del flujo platform/leads (mismo
// patrón que ReserveModal / Contacto). El `source` diferenciado permite
// filtrar estas solicitudes en el CRM de leads.
export default function CursoInscripcion() {
  const showToast = useToast()
  const formRef = useRef(null)
  const [submitting, setSubmitting] = useState(false)

  const onSubmit = async (e) => {
    e.preventDefault()
    const data = new FormData(e.currentTarget)
    setSubmitting(true)
    try {
      await leads.create({
        contactName: data.get('name'),
        email:       data.get('email'),
        message:     `Inscripción al curso profesional de Grafología Racional\nPerfil: ${data.get('perfil')}\n${data.get('notes') ?? ''}`.trim(),
        source:      'aulavera/grafocaligrafia-curso',
      })
      showToast('Solicitud enviada ✒️ Te confirmamos plaza por email.')
      formRef.current?.reset()
    } catch (err) {
      showToast(`No se pudo enviar la solicitud: ${err.message}`)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form ref={formRef} className="curso-form" onSubmit={onSubmit}>
      <span className="curso-plazas">{curso.notaPlazas}</span>
      <label htmlFor="grafo-name">Tu nombre</label>
      <input id="grafo-name" name="name" type="text" required />
      <label htmlFor="grafo-email">Tu email</label>
      <input id="grafo-email" name="email" type="email" required />
      <label htmlFor="grafo-perfil">Tu perfil</label>
      <select id="grafo-perfil" name="perfil" defaultValue="Profesor/a o educador/a">
        <option>Profesor/a o educador/a</option>
        <option>Psicólogo/a, psicopedagogo/a o terapeuta</option>
        <option>Padre / madre</option>
        <option>Otro — quiero conocer la técnica</option>
      </select>
      <label htmlFor="grafo-notes">¿Algo que debamos saber? <span style={{ color: 'var(--ink-mute)' }}>(opcional)</span></label>
      <textarea id="grafo-notes" name="notes" rows="3" />
      <label className="check" style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginTop: 18 }}>
        <input type="checkbox" required style={{ width: 'auto', marginTop: 5 }} />
        <span>Acepto el tratamiento de mis datos para gestionar esta solicitud.</span>
      </label>
      <button type="submit" className="btn btn-grafo" style={{ marginTop: 22 }} disabled={submitting}>
        {submitting ? 'Enviando…' : 'Solicitar plaza →'}
      </button>
      <p style={{ marginTop: 18, marginBottom: 0, fontStyle: 'italic', color: 'var(--ink-mute)', fontSize: '0.92rem' }}>
        También puedes escribir directamente a <a href={`mailto:${curso.email}`} style={{ color: 'var(--grafo-accent)' }}>{curso.email}</a>.
      </p>
    </form>
  )
}
