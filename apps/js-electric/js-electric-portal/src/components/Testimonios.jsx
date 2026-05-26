import { Star } from './icons.jsx'
import { testimonials, certifications } from '../data/mock.js'

export default function Testimonios() {
  return (
    <section className="relative py-24 sm:py-32 bg-electric-50/40">
      <div className="max-w-7xl mx-auto px-5 sm:px-8">
        <div className="grid lg:grid-cols-12 gap-10 mb-14">
          <div className="lg:col-span-6 reveal">
            <div className="text-xs uppercase tracking-[0.2em] text-electric-600 font-mono mb-4">— 04 / Testimonios</div>
            <h2 className="display text-4xl sm:text-5xl lg:text-6xl font-semibold leading-[1.02]">
              La confianza<br />se <em>conecta</em> con resultados.
            </h2>
          </div>
          <div className="lg:col-span-5 lg:col-start-8 flex items-end reveal reveal-delay-1">
            <div className="flex items-center gap-6">
              <div className="flex">
                {Array.from({ length: 5 }).map((_, i) => <Star key={i} className="w-6 h-6 text-spark-500" />)}
              </div>
              <div className="text-sm text-ink-700"><strong className="text-ink-900">4,9 / 5</strong> · 312 valoraciones</div>
            </div>
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-5">
          {testimonials.map((t, idx) => (
            <Testimonial key={t.name} t={t} delay={idx} />
          ))}
        </div>

        <div className="mt-16 reveal">
          <div className="text-xs uppercase tracking-widest text-ink-700/60 text-center mb-6">Avalados por</div>
          <div className="flex flex-wrap justify-center items-center gap-x-10 gap-y-4 opacity-70">
            {certifications.map((cert, i, arr) => (
              <span key={cert} className="flex items-center gap-x-10">
                <span className="font-display text-xl font-semibold tracking-tight">{cert}</span>
                {i < arr.length - 1 && <span className="w-1 h-1 rounded-full bg-ink-900/20"></span>}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

function Testimonial({ t, delay }) {
  return (
    <figure className={`reveal ${delay ? `reveal-delay-${delay}` : ''} bg-white rounded-2xl p-7 border border-ink-900/5 shadow-soft`}>
      <svg className="w-8 h-8 text-spark-500 mb-4" viewBox="0 0 24 24" fill="currentColor">
        <path d="M9 7H5a2 2 0 00-2 2v4a2 2 0 002 2h2v3a2 2 0 002 2V7zm10 0h-4a2 2 0 00-2 2v4a2 2 0 002 2h2v3a2 2 0 002 2V7z" />
      </svg>
      <blockquote className="font-display text-lg leading-relaxed text-ink-900 mb-6">"{t.text}"</blockquote>
      <figcaption className="flex items-center gap-3 pt-4 border-t border-ink-900/5">
        <div className={`w-10 h-10 rounded-full flex items-center justify-center font-display font-semibold ${t.avatarCls}`}>{t.avatar}</div>
        <div>
          <div className="font-medium text-sm">{t.name}</div>
          <div className="text-xs text-ink-700">{t.role}</div>
        </div>
      </figcaption>
    </figure>
  )
}
