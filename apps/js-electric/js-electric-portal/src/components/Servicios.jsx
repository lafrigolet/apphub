import { Arrow, SvgIcon } from './icons.jsx'
import { services } from '../data/mock.js'

export default function Servicios() {
  return (
    <section id="servicios" className="relative py-24 sm:py-32">
      <div className="max-w-7xl mx-auto px-5 sm:px-8">
        <div className="grid lg:grid-cols-12 gap-10 mb-14">
          <div className="lg:col-span-5 reveal">
            <div className="text-xs uppercase tracking-[0.2em] text-electric-600 font-mono mb-4">— 01 / Servicios</div>
            <h2 className="display text-4xl sm:text-5xl lg:text-6xl font-semibold leading-[1.02]">
              Todo lo que <em>conecta</em><br />tu vida con la energía.
            </h2>
          </div>
          <div className="lg:col-span-6 lg:col-start-7 reveal reveal-delay-1 flex items-end">
            <p className="text-lg text-ink-700 leading-relaxed">
              Diseñamos, instalamos y mantenemos. De la reforma eléctrica del piso al
              autoconsumo industrial: una sola empresa, un solo responsable, garantía total.
            </p>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {services.map((s, idx) => {
            const delay = idx % 3
            return s.highlighted
              ? <ServiceCardHighlight key={s.num} svc={s} delay={delay} />
              : <ServiceCard key={s.num} svc={s} delay={delay} />
          })}
        </div>
      </div>
    </section>
  )
}

function ServiceCard({ svc, delay }) {
  return (
    <article className={`svc-card group relative bg-white rounded-2xl p-7 border border-ink-900/8 shadow-soft reveal ${delay ? `reveal-delay-${delay}` : ''}`}>
      <div className="flex items-start justify-between mb-8">
        <div className="svc-icon-wrap w-14 h-14 rounded-xl bg-electric-50 text-electric-700 flex items-center justify-center">
          <SvgIcon d={svc.iconPath} />
        </div>
        <span className="num-tag font-mono text-xs text-ink-700/50">/ {svc.num}</span>
      </div>
      <h3 className="font-display text-2xl font-semibold mb-2">{svc.title}</h3>
      <p className="text-ink-700 text-sm leading-relaxed mb-5">{svc.desc}</p>
      <ul className="space-y-1.5 text-sm text-ink-800 mb-6">
        {svc.bullets.map((b) => (
          <li key={b} className="flex items-center gap-2"><span className="w-1 h-1 rounded-full bg-electric-500"></span>{b}</li>
        ))}
      </ul>
      <a href="#contacto" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-900 group-hover:text-electric-700 transition">
        Consultar
        <svg className="w-3.5 h-3.5 transition-transform group-hover:translate-x-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M13 5l7 7-7 7" /></svg>
      </a>
    </article>
  )
}

function ServiceCardHighlight({ svc, delay }) {
  return (
    <article className={`svc-card group relative bg-electric-500 text-white rounded-2xl p-7 border border-electric-500 shadow-electric reveal ${delay ? `reveal-delay-${delay}` : ''} overflow-hidden`}>
      <div className="absolute inset-0 opacity-30 grid-bg pointer-events-none"></div>
      <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-white/15 blur-2xl"></div>
      <div className="absolute -bottom-12 -left-8 w-32 h-32 rounded-full bg-electric-300/30 blur-2xl"></div>
      <div className="relative">
        <div className="flex items-start justify-between mb-8">
          <div className="w-14 h-14 rounded-xl bg-white text-electric-600 flex items-center justify-center">
            <svg className="w-7 h-7 ico" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <circle cx="12" cy="12" r="4" strokeWidth="1.8" />
              <path strokeLinecap="round" strokeWidth="1.8" d="M12 2v3M12 19v3M2 12h3M19 12h3M4.93 4.93l2.12 2.12M16.95 16.95l2.12 2.12M4.93 19.07l2.12-2.12M16.95 7.05l2.12-2.12" />
            </svg>
          </div>
          <span className="num-tag font-mono text-xs text-white/50">/ {svc.num}</span>
        </div>
        {svc.badge && (
          <span className="inline-block px-2.5 py-0.5 rounded-full bg-spark-400 text-ink-900 text-[10px] font-semibold uppercase tracking-wider mb-3">{svc.badge}</span>
        )}
        <h3 className="font-display text-2xl font-semibold mb-2 tracking-tight">{svc.title}</h3>
        <p className="text-white/85 text-sm leading-relaxed mb-5">{svc.desc}</p>
        <ul className="space-y-1.5 text-sm text-white/90 mb-6">
          {svc.bullets.map((b) => (
            <li key={b} className="flex items-center gap-2"><span className="w-1 h-1 rounded-full bg-white"></span>{b}</li>
          ))}
        </ul>
        <a href={svc.ctaHref ?? '#contacto'} className="inline-flex items-center gap-1.5 text-sm font-semibold text-white group-hover:gap-2.5 transition-all">
          {svc.ctaLabel ?? 'Consultar'}
          <Arrow className="w-3.5 h-3.5" />
        </a>
      </div>
    </article>
  )
}
