import { useState } from 'react'
import { contacto } from '../data/content.js'
import { Whatsapp, Mail, Instagram, Youtube, Arrow, Check } from './icons.jsx'
import { enviarConsulta } from '../lib/studio.js'

export default function Contacto() {
  const canales = [
    { Icon: Whatsapp, label: 'WhatsApp', value: contacto.telefono, href: contacto.whatsappMsg },
    { Icon: Mail, label: 'Email', value: contacto.email, href: contacto.emailLink },
    { Icon: Instagram, label: 'Instagram', value: contacto.instagram, href: contacto.instagramLink },
    { Icon: Youtube, label: 'YouTube', value: 'Canal de Lucía', href: contacto.youtubeLink },
  ]

  const [form, setForm] = useState({ contactName: '', email: '', phone: '', message: '', website: '' })
  const [estado, setEstado] = useState('idle')  // idle | enviando | ok | error
  const [err, setErr] = useState('')
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function onSubmit(e) {
    e.preventDefault()
    if (!form.contactName || !form.email || !form.message) { setErr('Nombre, email y mensaje son obligatorios'); return }
    setEstado('enviando'); setErr('')
    try {
      await enviarConsulta(form)
      setEstado('ok')
      setForm({ contactName: '', email: '', phone: '', message: '', website: '' })
    } catch (e2) {
      setEstado('error'); setErr(e2.message ?? 'No se pudo enviar el mensaje')
    }
  }

  const field = 'w-full rounded-xl border border-tinta/15 bg-crema px-4 py-2.5 focus:outline-none focus:border-teal-500'

  return (
    <section id="contacto" className="relative py-24 sm:py-32 overflow-hidden">
      <div className="absolute inset-0 wash-salvia opacity-70" aria-hidden="true" />
      <div className="relative max-w-6xl mx-auto px-5 sm:px-8">
        <div className="text-center">
          <p className="eyebrow reveal">— 07 / Contacto</p>
          <h2 className="display text-4xl sm:text-6xl mt-4 reveal reveal-delay-1">
            ¿Empezamos? <em>Escríbeme</em>.
          </h2>
          <p className="text-lg text-tinta/75 leading-relaxed max-w-xl mx-auto mt-6 reveal reveal-delay-1">
            Cuéntame qué buscas y vemos juntas el formato y el horario que mejor te encajan.
            Te respondo personalmente.
          </p>
        </div>

        <div className="grid lg:grid-cols-2 gap-8 mt-12 items-start">
          {/* Formulario (platform/inquiries) */}
          <form onSubmit={onSubmit} className="card-zen p-7 text-left reveal">
            {estado === 'ok' ? (
              <div className="flex flex-col items-center text-center gap-3 py-8">
                <span className="w-14 h-14 rounded-full bg-teal-500/15 text-teal-700 flex items-center justify-center"><Check className="w-7 h-7" /></span>
                <h3 className="display text-2xl">¡Mensaje enviado!</h3>
                <p className="text-tinta/65">Te responderé personalmente lo antes posible.</p>
                <button type="button" onClick={() => setEstado('idle')} className="btn-zen btn-outline mt-2">Enviar otro</button>
              </div>
            ) : (
              <>
                <span className="eyebrow">Escríbeme un mensaje</span>
                <div className="grid sm:grid-cols-2 gap-3 mt-4">
                  <input value={form.contactName} onChange={set('contactName')} placeholder="Nombre*" className={field} />
                  <input type="email" value={form.email} onChange={set('email')} placeholder="Email*" className={field} />
                </div>
                <input value={form.phone} onChange={set('phone')} placeholder="Teléfono (opcional)" className={`${field} mt-3`} />
                <textarea value={form.message} onChange={set('message')} rows={4} placeholder="¿Qué buscas? Cuéntame…*" className={`${field} mt-3`} />
                {/* Honeypot anti-spam (oculto) */}
                <input type="text" tabIndex={-1} autoComplete="off" value={form.website} onChange={set('website')}
                  className="hidden" aria-hidden="true" />
                {err && <p className="text-sm text-red-700 bg-red-500/10 rounded-lg px-3 py-2 mt-3">{err}</p>}
                <button type="submit" disabled={estado === 'enviando'} className="btn-zen btn-fill w-full justify-center mt-4">
                  {estado === 'enviando' ? 'Enviando…' : <>Enviar mensaje <Arrow className="w-4 h-4" /></>}
                </button>
                <p className="text-xs text-tinta/45 mt-3 text-center">¿Prefieres WhatsApp? <a href={contacto.whatsappMsg} target="_blank" rel="noopener noreferrer" className="text-teal-700 font-semibold hover:text-teal-600">Escríbeme por aquí</a>.</p>
              </>
            )}
          </form>

          {/* Canales directos */}
          <div className="grid sm:grid-cols-2 gap-4">
            {canales.map((c, i) => (
              <a key={c.label} href={c.href} target="_blank" rel="noopener noreferrer"
                className={`card-zen card-lift p-6 flex flex-col items-center gap-2.5 reveal ${i ? `reveal-delay-${i}` : ''}`}>
                <span className="w-12 h-12 rounded-full bg-teal-500/12 text-teal-600 flex items-center justify-center">
                  <c.Icon className="w-6 h-6" />
                </span>
                <span className="text-xs uppercase tracking-widest text-tinta/50 font-semibold">{c.label}</span>
                <span className="text-[15px] font-medium text-tinta text-center">{c.value}</span>
              </a>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
