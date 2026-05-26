import { useState } from 'react'
import { Arrow, Phone } from './icons.jsx'
import { contactInfo, formServices } from '../data/mock.js'
import { api } from '../lib/api.js'
import { APP_ID, resolveTenantId } from '../lib/tenant.js'

export default function Contacto({ showToast }) {
  const [servicio, setServicio] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const onSubmit = async (e) => {
    e.preventDefault()
    const data = new FormData(e.target)
    if (!data.get('nombre') || !data.get('email') || !data.get('telefono')) {
      showToast('Por favor completa los campos obligatorios.', false); return
    }
    if (!servicio) {
      showToast('Selecciona un servicio de interés.', false); return
    }

    setSubmitting(true)
    try {
      const tenantId = await resolveTenantId(APP_ID)
      await api('POST', '/api/inquiries/v1/inquiries', {
        appId:       APP_ID,
        tenantId,
        contactName: data.get('nombre'),
        email:       data.get('email'),
        phone:       data.get('telefono'),
        subject:     servicio,
        message:     data.get('mensaje') || '(sin mensaje)',
        source:      'landing-contact',
      })
      showToast('¡Solicitud enviada! Te llamaremos en menos de 24h.')
      e.target.reset()
      setServicio('')
    } catch (err) {
      showToast(`No pudimos enviar tu solicitud: ${err.message}`, false)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section id="contacto" className="relative py-24 sm:py-32 bg-ink-900 text-white overflow-hidden grain">
      <div className="absolute inset-0 grid-bg opacity-30 pointer-events-none"></div>
      <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-electric-700/30 rounded-full blur-3xl pointer-events-none -translate-y-1/2 translate-x-1/2"></div>
      <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-electric-500/30 rounded-full blur-3xl pointer-events-none translate-y-1/2 -translate-x-1/2"></div>

      <div className="relative max-w-7xl mx-auto px-5 sm:px-8 z-10">
        <div className="grid lg:grid-cols-12 gap-12">
          <div className="lg:col-span-5 reveal">
            <div className="text-xs uppercase tracking-[0.2em] text-electric-400 font-mono mb-4">— 07 / Contacto</div>
            <h2 className="display text-4xl sm:text-5xl lg:text-6xl font-semibold leading-[1.02] mb-6">Cuéntanos<br />tu <em>proyecto</em>.</h2>
            <p className="text-white/70 leading-relaxed mb-10 max-w-md">
              Te llamamos en menos de 24h. Presupuesto sin compromiso y visita técnica gratuita
              dentro de nuestra zona de servicio.
            </p>

            <div className="space-y-5">
              <ContactRow href={contactInfo.phoneHref} kicker="Teléfono" value={contactInfo.phone}
                icon={<Phone className="w-5 h-5 ico" />} />
              <ContactRow href={contactInfo.emailHref} kicker="Email" value={contactInfo.email}
                icon={<svg className="w-5 h-5 ico" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3 8l9 6 9-6M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>} />
              <ContactRow href={contactInfo.whatsappHref} kicker="WhatsApp" value={contactInfo.whatsapp}
                icon={<svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M.057 24l1.687-6.163a11.867 11.867 0 01-1.587-5.946C.16 5.335 5.495 0 12.05 0a11.817 11.817 0 018.413 3.488 11.824 11.824 0 013.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 01-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884a9.86 9.86 0 001.762 5.617l-.999 3.648 3.726-.964zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413z" /></svg>} />
              <ContactRow kicker="Oficina" value={contactInfo.office}
                icon={<svg className="w-5 h-5 ico" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a2 2 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><circle cx="12" cy="11" r="3" strokeWidth="1.6" /></svg>} />
            </div>
          </div>

          <div className="lg:col-span-6 lg:col-start-7 reveal reveal-delay-1">
            <form onSubmit={onSubmit} className="bg-white text-ink-900 rounded-3xl p-7 sm:p-9 shadow-lift" noValidate>
              <h3 className="font-display text-2xl font-semibold mb-1">Solicita presupuesto gratuito</h3>
              <p className="text-sm text-ink-700 mb-7">Te respondemos en menos de 24h laborables.</p>

              <div className="grid sm:grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-xs font-medium text-ink-700 mb-1.5">Nombre*</label>
                  <input name="nombre" type="text" required className="field w-full px-4 py-3 rounded-xl border border-ink-900/10 bg-bone/50 text-sm" placeholder="Tu nombre" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-ink-700 mb-1.5">Teléfono*</label>
                  <input name="telefono" type="tel" required className="field w-full px-4 py-3 rounded-xl border border-ink-900/10 bg-bone/50 text-sm" placeholder="600 00 00 00" />
                </div>
              </div>

              <div className="mb-4">
                <label className="block text-xs font-medium text-ink-700 mb-1.5">Email*</label>
                <input name="email" type="email" required className="field w-full px-4 py-3 rounded-xl border border-ink-900/10 bg-bone/50 text-sm" placeholder="tucorreo@email.com" />
              </div>

              <div className="mb-4">
                <label className="block text-xs font-medium text-ink-700 mb-1.5">Servicio de interés*</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {formServices.map((s) => {
                    const active = servicio === s.id
                    return (
                      <button key={s.id} type="button" onClick={() => setServicio(s.id)}
                        className={`px-3 py-2.5 rounded-lg text-xs font-medium transition border ${active ? 'bg-ink-900 text-white border-ink-900' : 'border-ink-900/10 bg-bone/50 hover:border-ink-900/30'}`}>
                        {s.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="mb-5">
                <label className="block text-xs font-medium text-ink-700 mb-1.5">Cuéntanos brevemente</label>
                <textarea name="mensaje" rows={3} className="field w-full px-4 py-3 rounded-xl border border-ink-900/10 bg-bone/50 text-sm resize-none" placeholder="Tipo de vivienda, superficie, fechas estimadas..." />
              </div>

              <label className="flex items-start gap-2.5 mb-6 cursor-pointer">
                <input type="checkbox" required className="mt-0.5 w-4 h-4 accent-ink-900 cursor-pointer" />
                <span className="text-xs text-ink-700 leading-relaxed">Acepto la <a href="#" className="underline">política de privacidad</a> y el tratamiento de mis datos para responder a esta solicitud.</span>
              </label>

              <button type="submit" disabled={submitting}
                className="btn-primary w-full inline-flex items-center justify-center gap-2 bg-ink-900 text-white px-6 py-4 rounded-full font-medium shadow-lift disabled:opacity-60 disabled:cursor-not-allowed">
                <span>{submitting ? 'Enviando…' : 'Enviar solicitud'}</span>
                {!submitting && <Arrow />}
              </button>
            </form>
          </div>
        </div>
      </div>
    </section>
  )
}

function ContactRow({ href, kicker, value, icon }) {
  const inner = (
    <>
      <div className="w-11 h-11 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center group-hover:bg-electric-500 group-hover:text-white transition">{icon}</div>
      <div>
        <div className="text-xs text-white/50 uppercase tracking-wider">{kicker}</div>
        <div className="font-display text-lg">{value}</div>
      </div>
    </>
  )
  if (!href) return <div className="flex items-center gap-4">{inner}</div>
  return <a href={href} className="flex items-center gap-4 group">{inner}</a>
}
