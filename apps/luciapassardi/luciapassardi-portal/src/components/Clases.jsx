import { clases, contacto } from '../data/content.js'
import { Check, Arrow } from './icons.jsx'

export default function Clases() {
  return (
    <section id="clases" className="relative py-24 sm:py-32">
      <div className="max-w-7xl mx-auto px-5 sm:px-8">
        <div className="grid lg:grid-cols-12 gap-8 mb-14">
          <div className="lg:col-span-6 reveal">
            <p className="eyebrow">— 01 / Clases</p>
            <h2 className="display text-4xl sm:text-5xl lg:text-6xl mt-4">
              Una práctica para <em>cada momento</em>.
            </h2>
          </div>
          <div className="lg:col-span-5 lg:col-start-8 flex items-end reveal reveal-delay-1">
            <p className="text-lg text-tinta/75 leading-relaxed">
              Elige el formato que mejor encaje contigo. Todos comparten lo mismo: cuidado,
              cercanía y respeto por tu ritmo.
            </p>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {clases.map((c, i) => (
            <article
              key={c.num}
              className={`card-zen card-lift p-8 reveal ${i ? `reveal-delay-${i}` : ''} ${
                c.destacada ? 'ring-1 ring-teal-500/40' : ''
              }`}
            >
              <div className="flex items-center justify-between mb-7">
                <span className="display text-3xl text-teal-600">{c.num}</span>
                {c.destacada && (
                  <span className="text-xs font-semibold uppercase tracking-widest text-teal-700 bg-teal-500/12 rounded-full px-3 py-1">
                    Más solicitado
                  </span>
                )}
              </div>
              <h3 className="display text-3xl mb-3">{c.title}</h3>
              <p className="text-tinta/70 leading-relaxed mb-6">{c.desc}</p>
              <ul className="space-y-2.5 mb-7">
                {c.bullets.map((b) => (
                  <li key={b} className="flex items-center gap-2.5 text-[15px] text-tinta/85">
                    <span className="text-teal-600"><Check className="w-4 h-4" /></span>
                    {b}
                  </li>
                ))}
              </ul>
              <a href={contacto.whatsappMsg} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-teal-700 font-semibold text-[15px] hover:gap-2.5 transition-all">
                Quiero saber más <Arrow className="w-4 h-4" />
              </a>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
