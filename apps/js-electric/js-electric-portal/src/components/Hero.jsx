import { Arrow, Star } from './icons.jsx'
import { stats, tickerItems } from '../data/mock.js'

export default function Hero() {
  return (
    <section id="inicio" className="relative pt-32 pb-20 sm:pt-40 sm:pb-28 overflow-hidden grain">
      <div className="absolute inset-0 -z-0 radial-glow"></div>
      <div className="absolute inset-x-0 top-0 -z-0">
        <svg className="w-full h-[480px] opacity-[0.05]" viewBox="0 0 1200 480" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <pattern id="lines" x="0" y="0" width="80" height="80" patternUnits="userSpaceOnUse">
              <path d="M0 80 L80 0" stroke="#0A1628" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#lines)" />
        </svg>
      </div>

      <div className="relative max-w-7xl mx-auto px-5 sm:px-8 z-10">
        <div className="grid lg:grid-cols-12 gap-12 items-center">
          <div className="lg:col-span-7">
            <div className="reveal inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-electric-50 border border-electric-200 text-xs font-medium text-electric-700">
              <span className="w-1.5 h-1.5 rounded-full bg-electric-500 spark-dot"></span>
              Instaladores autorizados · BT, RITE y RD 244/2019
            </div>

            <h1 className="reveal reveal-delay-1 display mt-6 text-5xl sm:text-6xl lg:text-7xl leading-[0.95]">
              Energía que <em>enciende</em><br />
              tu hogar, tu empresa,<br />
              tu <span className="relative inline-block">futuro
                <svg className="absolute -bottom-2 left-0 w-full" viewBox="0 0 200 10" preserveAspectRatio="none">
                  <path d="M2 7 Q 50 1, 100 6 T 198 5" fill="none" stroke="#0066FF" strokeWidth="3" strokeLinecap="round" />
                </svg>
              </span>.
            </h1>

            <p className="reveal reveal-delay-2 mt-8 max-w-xl text-lg text-ink-700 leading-relaxed">
              Instalaciones eléctricas, climatización, fotovoltaica y puntos de recarga para VE.
              Más de <strong className="text-ink-900">15 años</strong> diseñando soluciones energéticas
              que <em className="text-ink-900 not-italic font-medium">duran, ahorran y respetan</em>.
            </p>

            <div className="reveal reveal-delay-3 mt-10 flex flex-col sm:flex-row gap-3">
              <a href="#contacto" className="btn-primary inline-flex items-center justify-center gap-2 bg-electric-500 text-white px-7 py-4 rounded-full font-medium shadow-electric hover:bg-electric-600">
                Solicita tu presupuesto<Arrow />
              </a>
              <a href="#calculadora" className="inline-flex items-center justify-center gap-2 bg-white text-ink-900 px-7 py-4 rounded-full font-medium border border-ink-900/10 hover:border-electric-500 hover:text-electric-600 transition">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9" /><path strokeLinecap="round" d="M12 7v5l3 2" /></svg>
                Calcula tu ahorro solar
              </a>
            </div>

            <div className="reveal reveal-delay-4 mt-14 grid grid-cols-3 gap-6 max-w-lg">
              {stats.map((s) => (
                <div key={s.label}>
                  <div className="flex items-baseline gap-1">
                    <span className="counter font-display text-4xl sm:text-5xl font-semibold text-ink-900" data-target={s.target}>0</span>
                    <span className="text-electric-500 font-display text-2xl font-semibold">{s.suffix}</span>
                  </div>
                  <div className="text-xs uppercase tracking-wider text-ink-700 mt-1">{s.label}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="lg:col-span-5 reveal reveal-delay-2">
            <div className="relative">
              <div className="relative bg-ink-900 text-white rounded-3xl p-7 shadow-lift grid-bg overflow-hidden">
                <div className="absolute -top-20 -right-20 w-60 h-60 rounded-full bg-electric-500/30 blur-3xl"></div>
                <div className="relative flex items-center justify-between mb-6">
                  <span className="text-xs uppercase tracking-widest text-electric-300">Sistema activo</span>
                  <span className="flex items-center gap-1.5 text-xs">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-400 spark-dot"></span>en línea
                  </span>
                </div>
                <div className="relative font-display text-5xl font-semibold leading-none tracking-tight">7,42<span className="text-electric-400 ml-1">kWh</span></div>
                <div className="relative text-xs text-white/60 mt-1.5">Generación solar hoy · hogar tipo</div>
                <div className="relative hairline-light my-5"></div>
                <div className="relative grid grid-cols-3 gap-3 text-xs">
                  <div><div className="text-white/50 uppercase tracking-wider mb-1">Consumo</div><div className="font-medium text-base">3,1 kWh</div></div>
                  <div><div className="text-white/50 uppercase tracking-wider mb-1">Vertido</div><div className="font-medium text-base text-electric-300">4,3 kWh</div></div>
                  <div><div className="text-white/50 uppercase tracking-wider mb-1">CO₂ evit.</div><div className="font-medium text-base">2,9 kg</div></div>
                </div>
                <div className="relative mt-6 h-20">
                  <svg viewBox="0 0 300 80" className="w-full h-full" preserveAspectRatio="none">
                    <defs>
                      <linearGradient id="gradLine" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor="#3D7DFF" stopOpacity="0.5" />
                        <stop offset="100%" stopColor="#3D7DFF" stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    <path d="M0 70 L20 65 L40 55 L60 50 L80 40 L100 28 L120 18 L140 12 L160 14 L180 20 L200 32 L220 45 L240 58 L260 65 L280 72 L300 75 L300 80 L0 80 Z" fill="url(#gradLine)" />
                    <path d="M0 70 L20 65 L40 55 L60 50 L80 40 L100 28 L120 18 L140 12 L160 14 L180 20 L200 32 L220 45 L240 58 L260 65 L280 72 L300 75" fill="none" stroke="#3D7DFF" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                </div>
              </div>

              <div className="absolute -bottom-8 -left-4 sm:-left-8 bg-white rounded-2xl p-5 shadow-lift border border-ink-900/5 w-64">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-xl bg-electric-500 text-white flex items-center justify-center">
                    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M7 18l4-12 4 12M9 14h4" /></svg>
                  </div>
                  <div>
                    <div className="text-xs text-ink-700">Ahorro estimado</div>
                    <div className="font-display text-xl font-semibold tracking-tight">−68% factura</div>
                  </div>
                </div>
              </div>

              <div className="absolute -top-5 -right-2 sm:right-4 bg-electric-500 text-white rounded-full pl-2 pr-4 py-1.5 text-xs font-semibold shadow-electric flex items-center gap-2">
                <Star className="w-4 h-4" />Certificados oficiales
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Banner ticker */}
      <div className="mt-24 relative overflow-hidden bg-ink-900 text-white py-5 border-y border-white/10">
        <div className="flex marquee-track whitespace-nowrap gap-12 font-display text-2xl sm:text-3xl">
          {[0, 1].map((dup) => (
            <span key={dup} className="flex items-center gap-12 px-6" aria-hidden={dup === 1 ? 'true' : undefined}>
              {tickerItems.map((item, i) => (
                <span key={item + i} className="flex items-center gap-12">
                  <span>{item}</span><span className="text-electric-400">✦</span>
                </span>
              ))}
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}
