import { useEffect, useState } from 'react'
import { Arrow } from './icons.jsx'
import { api } from '../lib/api.js'
import { APP_ID, resolveTenantId } from '../lib/tenant.js'

// Modal de petición de presupuesto solar. Captura los valores actuales del
// simulador como `metadata.simulation` para que el comercial pueda ver el
// contexto de la oportunidad sin tener que reproducir la simulación.
//
// `simulation` viene de Calculadora.jsx con la forma:
//   { facturaMensual, area, tipo, orientacion,
//     potencia, ahorroAnual, roi, co2, coste }
// Todos los valores numéricos en raw (no formateados).
export default function BudgetRequestModal({ open, onClose, simulation, showToast }) {
  const [nombre, setNombre]       = useState('')
  const [email, setEmail]         = useState('')
  const [telefono, setTelefono]   = useState('')
  const [mensaje, setMensaje]     = useState('')
  const [gdpr, setGdpr]           = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Reset solo al abrir (transición closed→open). NO incluir onClose en deps:
  // el padre la pasa como función inline `() => setShowBudget(false)`, lo que
  // cambia su referencia cada vez que el padre re-renderiza (p.ej. cuando
  // showToast actualiza el estado del toast en Landing). Si dependiéramos de
  // onClose, el efecto se re-ejecutaría a mitad del flujo del usuario y
  // borraría los campos cuando llamáramos a showToast en un fallo de validación.
  useEffect(() => {
    if (!open) return
    setNombre(''); setEmail(''); setTelefono(''); setMensaje(''); setGdpr(false)
  }, [open])

  // Keyboard + body-scroll lock — sí dependen de onClose pero solo
  // adjuntan/limpian listeners; no tocan el estado del form.
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!open) return null

  const onSubmit = async (e) => {
    e.preventDefault()
    if (!nombre || !email || !telefono) {
      showToast('Por favor completa los campos obligatorios.', false); return
    }
    if (!gdpr) {
      showToast('Necesitas aceptar la política de privacidad.', false); return
    }
    setSubmitting(true)
    try {
      const tenantId = await resolveTenantId(APP_ID)
      await api('POST', '/api/inquiries/', {
        appId:       APP_ID,
        tenantId,
        contactName: nombre,
        email,
        phone:       telefono,
        subject:     'Solar',
        message:     mensaje || '(sin mensaje — petición desde la calculadora)',
        source:      'landing-budget',
        metadata:    { kind: 'budget', simulation },
      })
      showToast('¡Presupuesto solicitado! Te llamaremos en menos de 24h con tu propuesta exacta.')
      onClose()
    } catch (err) {
      showToast(`No pudimos enviar tu petición: ${err.message}`, false)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
         role="dialog" aria-modal="true" aria-labelledby="budget-modal-title">
      <button type="button" onClick={onClose}
        aria-label="Cerrar"
        className="absolute inset-0 bg-ink-900/70 backdrop-blur-sm" />

      <div className="relative bg-white text-ink-900 rounded-3xl shadow-lift w-full max-w-lg p-7 sm:p-8 max-h-[90vh] overflow-y-auto">
        <button type="button" onClick={onClose} aria-label="Cerrar"
          className="absolute top-4 right-4 w-9 h-9 rounded-full border border-ink-900/10 hover:border-ink-900/30 flex items-center justify-center transition">
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" d="M6 6l12 12M6 18L18 6" />
          </svg>
        </button>

        <h2 id="budget-modal-title" className="font-display text-2xl font-semibold mb-1">Pedir presupuesto exacto</h2>
        <p className="text-sm text-ink-700 mb-5">Te enviamos un presupuesto a medida con la simulación que has hecho. Sin compromiso.</p>

        <div className="bg-bone/60 border border-ink-900/5 rounded-2xl p-4 mb-5 text-xs">
          <div className="uppercase tracking-widest text-ink-700/60 mb-2">Tu simulación</div>
          <div className="grid grid-cols-2 gap-y-1.5 gap-x-4 text-ink-800">
            <div><span className="text-ink-700/60">Potencia:</span> <strong>{simulation?.potencia?.toFixed(1)} kWp</strong></div>
            <div><span className="text-ink-700/60">Ahorro/año:</span> <strong>{Math.round(simulation?.ahorroAnual ?? 0)} €</strong></div>
            <div><span className="text-ink-700/60">Amortización:</span> <strong>{simulation?.roi?.toFixed(1)} años</strong></div>
            <div><span className="text-ink-700/60">Inversión:</span> <strong>{Math.round(simulation?.coste ?? 0)} €</strong></div>
          </div>
        </div>

        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div>
            <label className="block text-xs font-medium text-ink-700 mb-1.5">Nombre*</label>
            <input type="text" value={nombre} onChange={(e) => setNombre(e.target.value)} required autoFocus
              className="field w-full px-4 py-3 rounded-xl border border-ink-900/10 bg-bone/50 text-sm" />
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-ink-700 mb-1.5">Email*</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
                className="field w-full px-4 py-3 rounded-xl border border-ink-900/10 bg-bone/50 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-700 mb-1.5">Teléfono*</label>
              <input type="tel" value={telefono} onChange={(e) => setTelefono(e.target.value)} required
                className="field w-full px-4 py-3 rounded-xl border border-ink-900/10 bg-bone/50 text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-700 mb-1.5">Mensaje (opcional)</label>
            <textarea value={mensaje} onChange={(e) => setMensaje(e.target.value)} rows={2}
              placeholder="Cubierta plana, urgente, vivienda nueva…"
              className="field w-full px-4 py-3 rounded-xl border border-ink-900/10 bg-bone/50 text-sm resize-none" />
          </div>

          <label className="flex items-start gap-2.5 cursor-pointer">
            <input type="checkbox" checked={gdpr} onChange={(e) => setGdpr(e.target.checked)}
              className="mt-0.5 w-4 h-4 accent-ink-900 cursor-pointer" />
            <span className="text-xs text-ink-700 leading-relaxed">Acepto la <a href="#" className="underline">política de privacidad</a>.</span>
          </label>

          <button type="submit" disabled={submitting}
            className="btn-primary w-full inline-flex items-center justify-center gap-2 bg-electric-500 text-white px-6 py-3.5 rounded-full font-medium shadow-electric disabled:opacity-60 disabled:cursor-not-allowed">
            <span>{submitting ? 'Enviando…' : 'Pedir presupuesto'}</span>
            {!submitting && <Arrow />}
          </button>
        </form>
      </div>
    </div>
  )
}
