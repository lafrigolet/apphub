import { contacto } from '../data/content.js'
import { Whatsapp, Mail, Instagram, Youtube, Arrow } from './icons.jsx'

export default function Contacto() {
  const canales = [
    { Icon: Whatsapp, label: 'WhatsApp', value: contacto.telefono, href: contacto.whatsappMsg },
    { Icon: Mail, label: 'Email', value: contacto.email, href: contacto.emailLink },
    { Icon: Instagram, label: 'Instagram', value: contacto.instagram, href: contacto.instagramLink },
    { Icon: Youtube, label: 'YouTube', value: 'Canal de Lucía', href: contacto.youtubeLink },
  ]

  return (
    <section id="contacto" className="relative py-24 sm:py-32 overflow-hidden">
      <div className="absolute inset-0 wash-salvia opacity-70" aria-hidden="true" />
      <div className="relative max-w-5xl mx-auto px-5 sm:px-8 text-center">
        <p className="eyebrow reveal">— 07 / Contacto</p>
        <h2 className="display text-4xl sm:text-6xl mt-4 reveal reveal-delay-1">
          ¿Empezamos? <em>Escríbeme</em>.
        </h2>
        <p className="text-lg text-tinta/75 leading-relaxed max-w-xl mx-auto mt-6 reveal reveal-delay-1">
          Cuéntame qué buscas y vemos juntas el formato y el horario que mejor te encajan.
          Te respondo personalmente.
        </p>

        <a href={contacto.whatsappMsg} target="_blank" rel="noopener noreferrer"
          className="btn-zen btn-fill mt-9 reveal reveal-delay-2">
          Contacta conmigo por WhatsApp <Arrow className="w-4 h-4" />
        </a>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-14">
          {canales.map((c, i) => (
            <a key={c.label} href={c.href} target="_blank" rel="noopener noreferrer"
              className={`card-zen card-lift p-6 flex flex-col items-center gap-2.5 reveal ${i ? `reveal-delay-${i}` : ''}`}>
              <span className="w-12 h-12 rounded-full bg-teal-500/12 text-teal-600 flex items-center justify-center">
                <c.Icon className="w-6 h-6" />
              </span>
              <span className="text-xs uppercase tracking-widest text-tinta/50 font-semibold">{c.label}</span>
              <span className="text-[15px] font-medium text-tinta">{c.value}</span>
            </a>
          ))}
        </div>
      </div>
    </section>
  )
}
