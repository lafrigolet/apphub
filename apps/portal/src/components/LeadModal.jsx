// Lead-capture modal — POSTs to platform-leads (/api/leads/v1).
//
// Three UI states driven by `phase`:
//   'form'    : the form is shown, user can submit
//   'sending' : button disabled, spinner shown
//   'success' : "gracias" panel; form is hidden, only a close button
//
// We close the modal on `Escape` and on backdrop click. Focus is moved to the
// first input on open via `autoFocus` (no FocusTrap dep — a single-pane modal
// is forgiving enough). For accessibility, the wrapper carries role=dialog
// and aria-modal=true. ToastProvider isn't used: success/error feedback lives
// inside the modal itself.

import { useEffect, useRef, useState } from 'react'

const INDUSTRY_OPTIONS = [
  { value: '',           label: 'Selecciona tu sector (opcional)' },
  { value: 'restaurant', label: 'Restaurante / hostelería' },
  { value: 'gym',        label: 'Gimnasio / estudio de yoga' },
  { value: 'services',   label: 'Servicios y citas (clínica, asesor, …)' },
  { value: 'shop',       label: 'Tienda / marketplace' },
  { value: 'other',      label: 'Otro' },
]

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? ''
// nginx maps /api/leads/ → http://platform_core/v1/leads/, so the
// client just hits /api/leads/ — the v1 versioning is internal.
const ENDPOINT = `${API_BASE}/api/leads/`

export default function LeadModal({ open, source, onClose }) {
  const [phase, setPhase]   = useState('form')
  const [error, setError]   = useState(null)
  const [form, setForm]     = useState({
    contactName:  '',
    email:        '',
    businessName: '',
    phone:        '',
    industry:     '',
    message:      '',
  })
  const firstInputRef = useRef(null)

  // Reset state every time the modal re-opens so a previous success state
  // doesn't bleed into a new submission.
  useEffect(() => {
    if (open) {
      setPhase('form')
      setError(null)
      setForm({ contactName: '', email: '', businessName: '', phone: '', industry: '', message: '' })
    }
  }, [open])

  // Escape closes the modal.
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  async function onSubmit(e) {
    e.preventDefault()
    setError(null)
    setPhase('sending')
    try {
      const body = {
        contactName:  form.contactName.trim(),
        email:        form.email.trim(),
        businessName: form.businessName.trim() || null,
        phone:        form.phone.trim() || null,
        industry:     form.industry || null,
        message:      form.message.trim() || null,
        source,
      }
      const res = await fetch(ENDPOINT, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}))
        throw new Error(payload?.error?.message ?? `HTTP ${res.status}`)
      }
      setPhase('success')
    } catch (err) {
      setError(err.message ?? 'No se pudo enviar el formulario')
      setPhase('form')
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="lead-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      {/* Backdrop — click closes */}
      <div
        aria-hidden
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
      />

      {/* Card */}
      <div className="relative w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-2xl">
        {phase === 'success' ? (
          <SuccessPanel onClose={onClose} />
        ) : (
          <form onSubmit={onSubmit} className="p-7">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h2 id="lead-modal-title" className="text-xl font-semibold text-slate-900">
                  Solicita una demo
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  Te contactamos en menos de 48 horas.
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Cerrar"
                className="rounded p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-5 w-5">
                  <path d="M6 6l12 12M6 18L18 6" />
                </svg>
              </button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nombre" htmlFor="lm-name" required>
                <input
                  id="lm-name"
                  ref={firstInputRef}
                  autoFocus
                  type="text"
                  required
                  maxLength={128}
                  value={form.contactName}
                  onChange={(e) => update('contactName', e.target.value)}
                  className={inputCls}
                />
              </Field>
              <Field label="Email" htmlFor="lm-email" required>
                <input
                  id="lm-email"
                  type="email"
                  required
                  maxLength={256}
                  value={form.email}
                  onChange={(e) => update('email', e.target.value)}
                  className={inputCls}
                />
              </Field>
              <Field label="Empresa / negocio" htmlFor="lm-business">
                <input
                  id="lm-business"
                  type="text"
                  maxLength={256}
                  value={form.businessName}
                  onChange={(e) => update('businessName', e.target.value)}
                  className={inputCls}
                />
              </Field>
              <Field label="Teléfono" htmlFor="lm-phone">
                <input
                  id="lm-phone"
                  type="tel"
                  maxLength={32}
                  value={form.phone}
                  onChange={(e) => update('phone', e.target.value)}
                  className={inputCls}
                />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Sector" htmlFor="lm-industry">
                  <select
                    id="lm-industry"
                    value={form.industry}
                    onChange={(e) => update('industry', e.target.value)}
                    className={inputCls}
                  >
                    {INDUSTRY_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="¿Qué necesitas? (opcional)" htmlFor="lm-message">
                  <textarea
                    id="lm-message"
                    rows={4}
                    maxLength={4000}
                    value={form.message}
                    onChange={(e) => update('message', e.target.value)}
                    className={inputCls}
                  />
                </Field>
              </div>
            </div>

            {error && (
              <div className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {error}
              </div>
            )}

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md px-4 py-2 text-sm font-medium text-slate-600 transition hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={phase === 'sending'}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-indigo-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {phase === 'sending' && (
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="9" strokeOpacity="0.25" />
                    <path d="M21 12a9 9 0 0 0-9-9" strokeLinecap="round" />
                  </svg>
                )}
                <span>{phase === 'sending' ? 'Enviando…' : 'Enviar'}</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

const inputCls =
  'block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40'

function Field({ label, htmlFor, required, children }) {
  return (
    <label htmlFor={htmlFor} className="block">
      <span className="mb-1 block text-xs font-medium text-slate-700">
        {label}{required && <span className="ml-0.5 text-rose-500">*</span>}
      </span>
      {children}
    </label>
  )
}

function SuccessPanel({ onClose }) {
  return (
    <div className="px-7 py-10 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
          <path d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <h3 className="mt-4 text-xl font-semibold text-slate-900">¡Recibido!</h3>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-slate-600">
        Te respondemos en menos de 48 horas al email que nos has dado. Mientras
        tanto, si tienes algo urgente, escríbenos a{' '}
        <a href="mailto:hola@hulkstein.com" className="font-medium text-indigo-600 hover:text-indigo-700">
          hola@hulkstein.com
        </a>.
      </p>
      <button
        type="button"
        onClick={onClose}
        className="mt-7 rounded-md bg-indigo-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
      >
        Cerrar
      </button>
    </div>
  )
}
