import { useEffect, useRef, useState } from 'react'

// Iconos SVG inline — los reutilizamos en varios sitios. Stroke-width
// configurable; el resto sigue el diseño del prototipo original.
const Arrow = ({ className = 'w-4 h-4' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M13 5l7 7-7 7" />
  </svg>
)

const Star = ({ className = 'w-6 h-6' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2l2.39 7.36H22l-6.2 4.5L18.18 22 12 17.5 5.82 22l2.38-8.14L2 9.36h7.61z" />
  </svg>
)

const Phone = ({ className = 'w-4 h-4 ico' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 5.5C3 4.12 4.12 3 5.5 3h2.13a2 2 0 011.94 1.5l.7 2.8a2 2 0 01-.5 1.9L8.4 10.6a14 14 0 005 5l1.4-1.37a2 2 0 011.9-.5l2.8.7A2 2 0 0121 16.37V18.5c0 1.38-1.12 2.5-2.5 2.5C10.4 21 3 13.6 3 5.5z" />
  </svg>
)

const Check = ({ className = 'w-5 h-5' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
  </svg>
)

// ── Reveal-on-scroll: IntersectionObserver añade .visible a cualquier
//    elemento con .reveal. Se ejecuta una vez al montar.
function useReveal() {
  useEffect(() => {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add('visible')
          io.unobserve(e.target)
        }
      })
    }, { threshold: 0.12 })
    document.querySelectorAll('.reveal').forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])
}

// ── Counter: anima desde 0 hasta data-target cuando entra al viewport.
function useCounters() {
  useEffect(() => {
    const counterIO = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return
        const el = e.target
        const target = +el.dataset.target
        const dur = 1600
        const t0 = performance.now()
        const step = (t) => {
          const p = Math.min((t - t0) / dur, 1)
          const eased = 1 - Math.pow(1 - p, 3)
          el.textContent = Math.round(eased * target).toLocaleString('es-ES')
          if (p < 1) requestAnimationFrame(step)
        }
        requestAnimationFrame(step)
        counterIO.unobserve(el)
      })
    }, { threshold: 0.5 })
    document.querySelectorAll('.counter').forEach((el) => counterIO.observe(el))
    return () => counterIO.disconnect()
  }, [])
}

// ── Header shadow al hacer scroll
function useHeaderShadow() {
  useEffect(() => {
    const header = document.getElementById('site-header')
    if (!header) return
    const onScroll = () => {
      if (window.scrollY > 8) header.classList.add('shadow-soft')
      else header.classList.remove('shadow-soft')
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
}

// ── Calculadora solar: lógica pura sobre slider values + tipo + orientación
function useSolarCalc({ bill, area, typeMul, orientMul }) {
  const maxByArea = area / 5
  const maxByBill = (bill / 25) * (typeMul === 1 ? 1 : 1.4)
  const power = Math.max(1, Math.min(maxByArea, maxByBill))
  const yearGen = power * 1650 * orientMul
  const yearSaving = yearGen * 0.18 * (typeMul === 1 ? 0.75 : 0.85)
  const cost = power * 1200
  const roi = cost / yearSaving
  const co2 = yearGen * 0.00027
  const fmt = (n, d = 0) => Number(n).toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d })
  return {
    power:    fmt(power, 1).replace('.', ','),
    saving:   fmt(yearSaving, 0),
    roi:      fmt(roi, 1).replace('.', ','),
    co2:      fmt(co2, 1).replace('.', ','),
    cost:     fmt(cost, 0) + '€',
  }
}

export default function Landing() {
  useReveal()
  useCounters()
  useHeaderShadow()

  // ── Mobile nav ────────────────────────────────────────────
  const [menuOpen, setMenuOpen] = useState(false)
  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : ''
    const onKey = (e) => { if (e.key === 'Escape' && menuOpen) setMenuOpen(false) }
    const onResize = () => { if (window.innerWidth >= 1024) setMenuOpen(false) }
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onResize)
    }
  }, [menuOpen])

  // ── Calculadora ────────────────────────────────────────────
  const [bill, setBill]     = useState(120)
  const [area, setArea]     = useState(30)
  const [typeMul, setTypeMul]     = useState(1)     // 1=residencial, 1.6=empresa
  const [orientMul, setOrientMul] = useState(1)     // 0.6=plana, 0.85=E/O, 1=Sur
  const calc = useSolarCalc({ bill, area, typeMul, orientMul })

  const sliderStyle = (v, min, max) => ({ '--val': `${((v - min) / (max - min)) * 100}%` })

  // ── Formulario contacto ────────────────────────────────────
  const [servicio, setServicio] = useState('')
  const [toast, setToast]       = useState({ msg: '', show: false, ok: true })
  const toastTimer = useRef(null)
  const showToast = (msg, ok = true) => {
    setToast({ msg, ok, show: true })
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast((t) => ({ ...t, show: false })), 3500)
  }
  useEffect(() => () => toastTimer.current && clearTimeout(toastTimer.current), [])

  const onSubmit = (e) => {
    e.preventDefault()
    const data = new FormData(e.target)
    if (!data.get('nombre') || !data.get('email') || !data.get('telefono')) {
      showToast('Por favor completa los campos obligatorios.', false); return
    }
    if (!servicio) {
      showToast('Selecciona un servicio de interés.', false); return
    }
    // Stub: en V2 conectar a /api/inquiries/ del platform-core.
    showToast('¡Solicitud enviada! Te llamaremos en menos de 24h.')
    e.target.reset()
    setServicio('')
  }

  const services = ['Eléctrica', 'Aire', 'Solar', 'VE', 'Domótica', 'Mantenimiento']
  const serviceLabels = {
    'Eléctrica': '⚡ Eléctrica',
    'Aire':      '❄ Aire acond.',
    'Solar':     '☀ Solar',
    'VE':        '🔌 Cargador VE',
    'Domótica':  '🏠 Domótica',
    'Mantenimiento': '🛠 Manten.',
  }

  return (
    <div className="bg-bone text-ink-900 antialiased">

      {/* ====================== HEADER ====================== */}
      <header id="site-header" className="fixed top-0 inset-x-0 z-50 header-blur bg-bone/70 border-b border-ink-900/5">
        <div className="max-w-7xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between">
          <a href="#inicio" className="flex items-center gap-2.5 group">
            <span className="relative inline-flex items-center justify-center w-10 h-10 rounded-xl bg-electric-500 text-white shadow-electric">
              <span className="font-display font-bold text-sm tracking-tight">JS</span>
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-spark-400 spark-dot"></span>
            </span>
            <span className="font-display text-xl font-semibold tracking-tight">JS Electric<span className="text-electric-500">.</span></span>
          </a>

          <nav className="hidden lg:flex items-center gap-8 text-sm font-medium text-ink-700">
            <a href="#servicios" className="hover:text-ink-900 transition">Servicios</a>
            <a href="#proyectos" className="hover:text-ink-900 transition">Proyectos</a>
            <a href="#calculadora" className="hover:text-ink-900 transition">Ahorro Solar</a>
            <a href="#empresa" className="hover:text-ink-900 transition">Empresa</a>
            <a href="#blog" className="hover:text-ink-900 transition">Recursos</a>
          </nav>

          <div className="flex items-center gap-3">
            <a href="tel:+34900123456" className="hidden sm:flex items-center gap-2 text-sm font-medium text-ink-800 hover:text-electric-600 transition">
              <Phone />900 123 456
            </a>
            <a href="#contacto" className="btn-primary inline-flex items-center gap-2 bg-electric-500 text-white px-4 py-2.5 rounded-full text-sm font-medium shadow-electric hover:bg-electric-600">
              Presupuesto gratis<Arrow />
            </a>
            <button type="button" onClick={() => setMenuOpen((v) => !v)}
              className="lg:hidden inline-flex items-center justify-center w-10 h-10 rounded-lg border border-ink-900/10 hover:border-ink-900/30 transition"
              aria-label={menuOpen ? 'Cerrar menú' : 'Abrir menú'} aria-expanded={menuOpen} aria-controls="mobile-nav">
              {menuOpen
                ? <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" d="M6 6l12 12M6 18L18 6" /></svg>
                : <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" d="M4 7h16M4 12h16M4 17h16" /></svg>}
            </button>
          </div>
        </div>

        <div id="mobile-nav" className={`mobile-nav ${menuOpen ? 'open' : ''} lg:hidden absolute left-0 right-0 top-full border-t border-ink-900/5 bg-bone shadow-soft`}>
          <nav className="px-6 py-4 flex flex-col gap-1 text-ink-800 font-medium">
            <a href="#servicios" onClick={() => setMenuOpen(false)} className="py-3 border-b border-ink-900/5 hover:text-electric-600 transition">Servicios</a>
            <a href="#proyectos" onClick={() => setMenuOpen(false)} className="py-3 border-b border-ink-900/5 hover:text-electric-600 transition">Proyectos</a>
            <a href="#calculadora" onClick={() => setMenuOpen(false)} className="py-3 border-b border-ink-900/5 hover:text-electric-600 transition">Ahorro Solar</a>
            <a href="#empresa" onClick={() => setMenuOpen(false)} className="py-3 border-b border-ink-900/5 hover:text-electric-600 transition">Empresa</a>
            <a href="#blog" onClick={() => setMenuOpen(false)} className="py-3 border-b border-ink-900/5 hover:text-electric-600 transition">Recursos</a>
            <a href="tel:+34900123456" className="py-3 text-electric-600 font-semibold">📞 900 123 456</a>
          </nav>
        </div>
      </header>

      {/* ====================== HERO ====================== */}
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
                {[
                  { target: 15,   suffix: '+', label: 'años activos' },
                  { target: 2400, suffix: '+', label: 'instalaciones' },
                  { target: 98,   suffix: '%', label: 'satisfacción' },
                ].map((s) => (
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
                <span>Instalaciones Eléctricas</span><span className="text-electric-400">✦</span>
                <span>Aire Acondicionado</span><span className="text-electric-400">✦</span>
                <span>Placas Solares</span><span className="text-electric-400">✦</span>
                <span>Cargadores VE</span><span className="text-electric-400">✦</span>
                <span>Domótica</span><span className="text-electric-400">✦</span>
                <span>Mantenimientos</span><span className="text-electric-400">✦</span>
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ====================== SERVICIOS ====================== */}
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
            {/* 6 servicios — el #3 (Solar) es destacado */}
            <ServiceCard num="01" title="Instalaciones eléctricas"
              desc="Nuevas instalaciones, reformas, boletines y legalizaciones. Cuadros, líneas, puesta a tierra, iluminación técnica y decorativa."
              bullets={['Viviendas y locales', 'Boletines CIE', 'BT / IT industrial']}
              icon={<svg className="w-7 h-7 ico" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M13 2L4 14h6l-1 8 9-12h-6l1-8z" /></svg>} />

            <ServiceCard num="02" title="Aire acondicionado" delay={1}
              desc="Climatización eficiente: split, multisplit, conductos y aerotermia. Diseño térmico, instalación y mantenimiento."
              bullets={['Inverter A+++', 'Aerotermia', 'Carnet RITE']}
              icon={<svg className="w-7 h-7 ico" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3 7h18M3 12h18M3 17h12M19 17l-2-2m2 2l-2 2" /></svg>} />

            <ServiceCardHighlight num="03" delay={2}
              icon={<svg className="w-7 h-7 ico" viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="4" strokeWidth="1.8" /><path strokeLinecap="round" strokeWidth="1.8" d="M12 2v3M12 19v3M2 12h3M19 12h3M4.93 4.93l2.12 2.12M16.95 16.95l2.12 2.12M4.93 19.07l2.12-2.12M16.95 7.05l2.12-2.12" /></svg>} />

            <ServiceCard num="04" title="Cargadores VE"
              desc="Puntos de recarga para vehículo eléctrico en garajes privados, comunidades y empresas. Carga inteligente y solar."
              bullets={['Wallbox, V2H, OCPP', 'Carga compartida', 'MOVES III']}
              icon={<svg className="w-7 h-7 ico" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" d="M5 11V7a2 2 0 012-2h6a2 2 0 012 2v12a2 2 0 01-2 2H7a2 2 0 01-2-2v-4M5 11h6m-6 4h6M17 9l3 3-3 3" /></svg>} />

            <ServiceCard num="05" title="Domótica & IoT" delay={1}
              desc="Hogar y oficina conectados. Iluminación, climatización, persianas y consumos bajo control desde tu móvil."
              bullets={['KNX · Loxone · Shelly', 'Asistentes de voz', 'Monitor energético']}
              icon={<svg className="w-7 h-7 ico" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" d="M4 7h16M4 12h16M4 17h16" /><circle cx="8" cy="7" r="1.4" fill="currentColor" /><circle cx="14" cy="12" r="1.4" fill="currentColor" /><circle cx="10" cy="17" r="1.4" fill="currentColor" /></svg>} />

            <ServiceCard num="06" title="Mantenimientos" delay={2}
              desc="Contratos de mantenimiento preventivo y correctivo para comunidades, locales e industrias. SAT 24/7."
              bullets={['Revisiones OCA', 'Urgencias 24h', 'Termografías']}
              icon={<svg className="w-7 h-7 ico" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" d="M9 12l2 2 4-4M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>} />
          </div>
        </div>
      </section>

      {/* ====================== PROYECTOS ====================== */}
      <section id="proyectos" className="relative py-24 sm:py-32 bg-ink-900 text-white overflow-hidden grain">
        <div className="absolute inset-0 grid-bg opacity-40 pointer-events-none"></div>
        <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-electric-500/40 blur-3xl rounded-full pointer-events-none"></div>

        <div className="relative max-w-7xl mx-auto px-5 sm:px-8 z-10">
          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-8 mb-14">
            <div className="reveal max-w-2xl">
              <div className="text-xs uppercase tracking-[0.2em] text-electric-400 font-mono mb-4">— 02 / Proyectos</div>
              <h2 className="display text-4xl sm:text-5xl lg:text-6xl font-semibold leading-[1.02]">
                Algunos trabajos<br />que nos hacen <em>brillar</em>.
              </h2>
            </div>
            <p className="reveal reveal-delay-1 text-white/70 max-w-md">
              De viviendas unifamiliares a naves industriales con cubierta solar de 250kWp.
              Cada proyecto, una solución a medida.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-6 gap-4 sm:gap-5">
            <ProjectCard cls="md:col-span-4 md:row-span-2 h-[340px] md:h-[520px]"
              img="https://images.unsplash.com/photo-1509391366360-2e959784a276?auto=format&fit=crop&w=1400&q=80"
              kicker="Fotovoltaica residencial" title="Villa Mediterránea · 9,2 kWp" featured
              desc="Autoconsumo con baterías LiFePO₄ y cargador VE. Cubierta -73% factura anual." />
            <ProjectCard cls="md:col-span-2 h-[240px] md:h-[250px]" delay={1}
              img="https://images.unsplash.com/photo-1473341304170-971dccb5ac1e?auto=format&fit=crop&w=900&q=80"
              kicker="Climatización" title="Oficinas Triton" />
            <ProjectCard cls="md:col-span-2 h-[240px] md:h-[250px]" delay={2}
              img="https://images.unsplash.com/photo-1593941707882-a5bba14938c7?auto=format&fit=crop&w=900&q=80"
              kicker="Movilidad eléctrica" title="Parking 32 puntos" />
            <ProjectCard cls="md:col-span-3 h-[240px]"
              img="https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=1200&q=80"
              kicker="Industrial" title="Nave logística Norte" />
            <ProjectCard cls="md:col-span-3 h-[240px]" delay={1}
              img="https://images.unsplash.com/photo-1558002038-1055907df827?auto=format&fit=crop&w=1200&q=80"
              kicker="Domótica" title="Loft Centro · KNX" />
          </div>
        </div>
      </section>

      {/* ====================== CALCULADORA SOLAR ====================== */}
      <section id="calculadora" className="relative py-24 sm:py-32">
        <div className="max-w-7xl mx-auto px-5 sm:px-8">
          <div className="grid lg:grid-cols-12 gap-12 items-start">
            <div className="lg:col-span-5 lg:sticky lg:top-28 reveal">
              <div className="text-xs uppercase tracking-[0.2em] text-electric-600 font-mono mb-4">— 03 / Simulador</div>
              <h2 className="display text-4xl sm:text-5xl font-semibold leading-[1.02] mb-6">
                ¿Cuánto puedes <em>ahorrar</em> con placas solares?
              </h2>
              <p className="text-ink-700 leading-relaxed mb-8">
                Mueve los selectores y descubre tu ahorro estimado anual, el periodo de
                amortización y el CO₂ que dejarías de emitir. Sin compromiso.
              </p>
              <div className="space-y-3 text-sm text-ink-700">
                {[
                  'Cálculo basado en irradiación media peninsular (1.650h equivalentes/año)',
                  'Precio orientativo de instalación: 1.200€/kWp llave en mano',
                  'Resultado estimativo. Para presupuesto exacto, contacta con nosotros',
                ].map((line) => (
                  <div key={line} className="flex items-start gap-3">
                    <Check className="w-5 h-5 mt-0.5 text-electric-600 flex-shrink-0" />
                    <span>{line}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="lg:col-span-7 reveal reveal-delay-1">
              <div className="bg-white rounded-3xl shadow-lift border border-ink-900/5 p-8 sm:p-10">

                <div className="mb-8">
                  <label className="text-xs uppercase tracking-wider text-ink-700 font-medium block mb-3">Tipo de instalación</label>
                  <div className="grid grid-cols-2 gap-2">
                    {[['residencial', 1, 'Residencial'], ['empresa', 1.6, 'Empresa / Industrial']].map(([val, mul, lbl]) => {
                      const active = typeMul === mul
                      return (
                        <button key={val} type="button" onClick={() => setTypeMul(mul)}
                          className={`px-4 py-3 rounded-xl border-2 font-medium text-sm transition ${active ? 'border-ink-900 bg-ink-900 text-white' : 'border-ink-900/10 bg-white text-ink-700 hover:border-ink-900/30'}`}>
                          {lbl}
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div className="mb-8">
                  <div className="flex items-baseline justify-between mb-3">
                    <label className="text-xs uppercase tracking-wider text-ink-700 font-medium">Factura mensual de luz</label>
                    <span className="font-display text-2xl font-semibold text-ink-900">{bill}€</span>
                  </div>
                  <input type="range" min={40} max={600} step={10} value={bill}
                    onChange={(e) => setBill(+e.target.value)}
                    className="calc-slider"
                    style={sliderStyle(bill, 40, 600)} />
                  <div className="flex justify-between text-[10px] text-ink-700/60 mt-2 font-mono"><span>40€</span><span>600€</span></div>
                </div>

                <div className="mb-8">
                  <div className="flex items-baseline justify-between mb-3">
                    <label className="text-xs uppercase tracking-wider text-ink-700 font-medium">Superficie disponible (cubierta)</label>
                    <span className="font-display text-2xl font-semibold text-ink-900">{area} m²</span>
                  </div>
                  <input type="range" min={10} max={300} step={5} value={area}
                    onChange={(e) => setArea(+e.target.value)}
                    className="calc-slider"
                    style={sliderStyle(area, 10, 300)} />
                  <div className="flex justify-between text-[10px] text-ink-700/60 mt-2 font-mono"><span>10 m²</span><span>300 m²</span></div>
                </div>

                <div className="mb-8">
                  <label className="text-xs uppercase tracking-wider text-ink-700 font-medium block mb-3">Orientación</label>
                  <div className="grid grid-cols-4 gap-2">
                    {[['Este', 0.85], ['Sur', 1], ['Oeste', 0.85], ['Plana', 0.6]].map(([lbl, val]) => {
                      const active = orientMul === val && (lbl === 'Sur' || lbl !== 'Sur')
                      // El template original marca "Sur" como default (1). Para Este/Oeste comparten valor 0.85; el último click gana.
                      const isActive = orientMul === val
                      return (
                        <button key={lbl} type="button" onClick={() => setOrientMul(val)}
                          className={`px-3 py-2.5 rounded-lg font-medium text-xs transition ${isActive ? 'border-2 border-ink-900 bg-ink-900 text-white' : 'border border-ink-900/10 bg-white text-ink-700 hover:border-ink-900/30'}`}>
                          {lbl}
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div className="hairline mb-8"></div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
                  <div>
                    <div className="text-[10px] uppercase tracking-widest text-ink-700/70 mb-1.5">Potencia</div>
                    <div className="font-display text-2xl sm:text-3xl font-semibold text-ink-900">{calc.power}<span className="text-base text-ink-700 ml-0.5">kWp</span></div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-widest text-ink-700/70 mb-1.5">Ahorro anual</div>
                    <div className="font-display text-2xl sm:text-3xl font-semibold text-electric-700">{calc.saving}<span className="text-base ml-0.5">€</span></div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-widest text-ink-700/70 mb-1.5">Amortización</div>
                    <div className="font-display text-2xl sm:text-3xl font-semibold text-ink-900">{calc.roi}<span className="text-base text-ink-700 ml-0.5">años</span></div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-widest text-ink-700/70 mb-1.5">CO₂ evitado</div>
                    <div className="font-display text-2xl sm:text-3xl font-semibold text-ink-900">{calc.co2}<span className="text-base text-ink-700 ml-0.5">t/año</span></div>
                  </div>
                </div>

                <div className="bg-ink-900 text-white rounded-2xl p-6 grid-bg relative overflow-hidden">
                  <div className="absolute -right-12 -top-12 w-44 h-44 rounded-full bg-electric-500/30 blur-3xl"></div>
                  <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                      <div className="text-xs text-white/70 mb-1">Inversión estimada</div>
                      <div className="flex items-baseline gap-2">
                        <span className="font-display text-3xl font-semibold tracking-tight">{calc.cost}</span>
                        <span className="text-xs text-white/60">llave en mano</span>
                      </div>
                    </div>
                    <a href="#contacto" className="btn-primary inline-flex items-center justify-center gap-2 bg-electric-500 text-white px-6 py-3 rounded-full font-semibold text-sm shadow-electric">
                      Pedir presupuesto exacto<Arrow />
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ====================== TESTIMONIOS ====================== */}
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
            <Testimonial avatar="MR" avatarCls="bg-ink-900 text-white" name="Marta Ramírez" role="Particular · Sevilla"
              text="Cambiamos la instalación entera de casa y pusimos placas. Trabajo limpio, tiempos cumplidos, y la app para ver el consumo es una maravilla." />
            <Testimonial delay={1} avatar="JT" avatarCls="bg-electric-500 text-white" name="Javier Torres" role="Logística Ártica S.L."
              text="Instalaron 14 puntos de recarga en nuestro parking de empresa. Gestionaron la subvención MOVES y el alta sin que tuviéramos que mover un dedo." />
            <Testimonial delay={2} avatar="LP" avatarCls="bg-electric-300 text-ink-900" name="Laura Pérez" role="Particular · Madrid"
              text="Nos pusieron aerotermia y multisplit en toda la casa. La factura ha bajado a la mitad y el equipo técnico es de 10. Repetiremos seguro." />
          </div>

          <div className="mt-16 reveal">
            <div className="text-xs uppercase tracking-widest text-ink-700/60 text-center mb-6">Avalados por</div>
            <div className="flex flex-wrap justify-center items-center gap-x-10 gap-y-4 opacity-70">
              {['FENIE', 'UNEF', 'ISO 9001', 'RD 244/2019', 'RITE', 'IDAE'].map((cert, i, arr) => (
                <span key={cert} className="flex items-center gap-x-10">
                  <span className="font-display text-xl font-semibold tracking-tight">{cert}</span>
                  {i < arr.length - 1 && <span className="w-1 h-1 rounded-full bg-ink-900/20"></span>}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ====================== EMPRESA ====================== */}
      <section id="empresa" className="relative py-24 sm:py-32">
        <div className="max-w-7xl mx-auto px-5 sm:px-8">
          <div className="grid lg:grid-cols-12 gap-12 items-center">
            <div className="lg:col-span-5 reveal order-2 lg:order-1">
              <div className="relative">
                <div className="rounded-3xl overflow-hidden shadow-lift">
                  <img src="https://images.unsplash.com/photo-1581094794329-c8112a89af12?auto=format&fit=crop&w=900&q=80" alt="Equipo JS Electric" className="w-full h-[480px] object-cover" />
                </div>
                <div className="absolute -bottom-6 -right-4 sm:-right-8 bg-white rounded-2xl p-5 shadow-lift border border-ink-900/5 max-w-[240px]">
                  <div className="flex items-center gap-1 mb-2">
                    <Star className="w-4 h-4 text-spark-500" />
                    <span className="font-display text-sm font-semibold">Equipo certificado</span>
                  </div>
                  <p className="text-xs text-ink-700">12 técnicos titulados, carnet RITE y BT con formación continua.</p>
                </div>
              </div>
            </div>

            <div className="lg:col-span-6 lg:col-start-7 reveal reveal-delay-1 order-1 lg:order-2">
              <div className="text-xs uppercase tracking-[0.2em] text-electric-600 font-mono mb-4">— 05 / Empresa</div>
              <h2 className="display text-4xl sm:text-5xl lg:text-6xl font-semibold leading-[1.02] mb-8">
                Una empresa <em>local</em>,<br />con visión global.
              </h2>
              <p className="text-lg text-ink-700 leading-relaxed mb-6">
                Desde 2009 ayudamos a familias, comunidades y empresas a tomar el control
                de su energía. Empezamos con un electricista y una furgoneta; hoy somos
                un equipo de <strong className="text-ink-900">28 personas</strong> que diseña, instala y mantiene proyectos
                en toda la península.
              </p>
              <p className="text-ink-700 leading-relaxed mb-10">
                Lo que no ha cambiado: trato cercano, presupuestos transparentes
                y un compromiso real con la transición energética.
              </p>

              <div className="grid sm:grid-cols-2 gap-5">
                <Value title="Plazos cumplidos" desc="Compromiso por escrito. Si nos retrasamos, te bonificamos."
                  icon={<svg className="w-5 h-5 ico" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>} />
                <Value title="Garantía 10 años" desc="En instalación y materiales. Atención post-venta real."
                  icon={<svg className="w-5 h-5 ico" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>} />
                <Value title="Presupuesto claro" desc="Sin letra pequeña. Lo que firmas es lo que pagas."
                  icon={<svg className="w-5 h-5 ico" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 2l9 4.5v9L12 20l-9-4.5v-9L12 2z M12 2v18 M3 6.5l9 4.5 9-4.5" /></svg>} />
                <Value title="Llave en mano" desc="Nos ocupamos de todo: trámites, ayudas y legalización."
                  icon={<svg className="w-5 h-5 ico" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M13 2L4 14h6l-1 8 9-12h-6l1-8z" /></svg>} />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ====================== BLOG ====================== */}
      <section id="blog" className="relative py-24 sm:py-32 bg-bone border-t border-ink-900/5">
        <div className="max-w-7xl mx-auto px-5 sm:px-8">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-6 mb-12">
            <div className="reveal">
              <div className="text-xs uppercase tracking-[0.2em] text-electric-600 font-mono mb-4">— 06 / Recursos</div>
              <h2 className="display text-4xl sm:text-5xl font-semibold leading-[1.02]">Aprende, ahorra, <em>decide mejor</em>.</h2>
            </div>
            <a href="#" className="reveal reveal-delay-1 inline-flex items-center gap-1.5 text-sm font-medium text-ink-900 hover:gap-2.5 transition-all">
              Ver todos los artículos<Arrow />
            </a>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            <BlogPost img="https://images.unsplash.com/photo-1611365892117-bce8cd8b6262?auto=format&fit=crop&w=800&q=80"
              kicker="Guía · 8 min" title="¿Compensa instalar baterías solares en 2026? Análisis real"
              excerpt="Repasamos amortización, ciclos de vida y casos donde sí (y donde no) tiene sentido." />
            <BlogPost delay={1} img="https://images.unsplash.com/photo-1632833239869-a37e3a5806d2?auto=format&fit=crop&w=800&q=80"
              kicker="Subvenciones · 6 min" title="Cómo pedir el MOVES III para tu cargador VE paso a paso"
              excerpt="Documentación, plazos y cuánto tarda en llegar el dinero. La realidad sin marketing." />
            <BlogPost delay={2} img="https://images.unsplash.com/photo-1556761175-5973dc0f32e7?auto=format&fit=crop&w=800&q=80"
              kicker="Climatización · 5 min" title="Aerotermia vs caldera de gas: ¿qué te ahorra más al año?"
              excerpt="Comparativa con datos reales en vivienda media de 100m². Te sorprenderá." />
          </div>
        </div>
      </section>

      {/* ====================== CONTACTO ====================== */}
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
                <ContactRow href="tel:+34900123456" kicker="Teléfono" value="900 123 456"
                  icon={<Phone className="w-5 h-5 ico" />} />
                <ContactRow href="mailto:hola@jselectric.es" kicker="Email" value="hola@jselectric.es"
                  icon={<svg className="w-5 h-5 ico" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3 8l9 6 9-6M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>} />
                <ContactRow href="https://wa.me/34600000000" kicker="WhatsApp" value="+34 600 000 000"
                  icon={<svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M.057 24l1.687-6.163a11.867 11.867 0 01-1.587-5.946C.16 5.335 5.495 0 12.05 0a11.817 11.817 0 018.413 3.488 11.824 11.824 0 013.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 01-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884a9.86 9.86 0 001.762 5.617l-.999 3.648 3.726-.964zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413z" /></svg>} />
                <ContactRow kicker="Oficina" value="C/ Energía 42, Madrid"
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
                    {services.map((s) => {
                      const active = servicio === s
                      return (
                        <button key={s} type="button" onClick={() => setServicio(s)}
                          className={`px-3 py-2.5 rounded-lg text-xs font-medium transition border ${active ? 'bg-ink-900 text-white border-ink-900' : 'border-ink-900/10 bg-bone/50 hover:border-ink-900/30'}`}>
                          {serviceLabels[s]}
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

                <button type="submit" className="btn-primary w-full inline-flex items-center justify-center gap-2 bg-ink-900 text-white px-6 py-4 rounded-full font-medium shadow-lift">
                  <span>Enviar solicitud</span><Arrow />
                </button>
              </form>
            </div>
          </div>
        </div>
      </section>

      {/* ====================== FOOTER ====================== */}
      <footer className="bg-ink-900 text-white/70 border-t border-white/5">
        <div className="max-w-7xl mx-auto px-5 sm:px-8 py-14">
          <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-10 mb-12">
            <div className="lg:col-span-2">
              <a href="#inicio" className="flex items-center gap-2.5 mb-5">
                <span className="relative inline-flex items-center justify-center w-10 h-10 rounded-xl bg-electric-500 text-white">
                  <span className="font-display font-bold text-sm tracking-tight">JS</span>
                </span>
                <span className="font-display text-xl font-semibold tracking-tight text-white">JS Electric<span className="text-electric-400">.</span></span>
              </a>
              <p className="text-sm leading-relaxed max-w-xs mb-5">
                Electricistas, climatización y energía solar. Tu transición energética, llave en mano.
              </p>
              <div className="flex gap-2">
                {[
                  ['Instagram', <svg key="i" className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2c2.717 0 3.056.01 4.122.06 1.065.05 1.79.217 2.428.465.66.254 1.216.598 1.772 1.153a4.908 4.908 0 011.153 1.772c.247.637.415 1.363.465 2.428.047 1.066.06 1.405.06 4.122 0 2.717-.01 3.056-.06 4.122-.05 1.065-.218 1.79-.465 2.428a4.883 4.883 0 01-1.153 1.772 4.915 4.915 0 01-1.772 1.153c-.637.247-1.363.415-2.428.465-1.066.047-1.405.06-4.122.06-2.717 0-3.056-.01-4.122-.06-1.065-.05-1.79-.218-2.428-.465a4.89 4.89 0 01-1.772-1.153 4.904 4.904 0 01-1.153-1.772c-.248-.637-.415-1.363-.465-2.428C2.013 15.056 2 14.717 2 12c0-2.717.01-3.056.06-4.122.05-1.066.217-1.79.465-2.428a4.88 4.88 0 011.153-1.772A4.897 4.897 0 015.45 2.525c.638-.248 1.362-.415 2.428-.465C8.944 2.013 9.283 2 12 2zm0 5a5 5 0 100 10 5 5 0 000-10zm6.5-.25a1.25 1.25 0 10-2.5 0 1.25 1.25 0 002.5 0zM12 9a3 3 0 110 6 3 3 0 010-6z" /></svg>],
                  ['LinkedIn', <svg key="l" className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M19 3a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h14zM8 17v-7H5.5v7H8zM6.75 8.75A1.5 1.5 0 108.5 7.25a1.5 1.5 0 00-1.75 1.5zM18.5 17v-4.4c0-2.1-1.13-3.1-2.65-3.1a2.3 2.3 0 00-2.1 1.15V10H11.4v7h2.4v-3.7c0-1.04.2-2.05 1.5-2.05 1.27 0 1.27 1.2 1.27 2.12V17h1.93z" /></svg>],
                  ['Facebook', <svg key="f" className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12a12 12 0 10-13.875 11.85V15.47H7.078V12h3.047V9.36c0-3.007 1.79-4.668 4.532-4.668 1.312 0 2.686.234 2.686.234v2.953H15.83c-1.491 0-1.956.925-1.956 1.875V12h3.328l-.532 3.47h-2.796v8.38A12 12 0 0024 12z" /></svg>],
                ].map(([name, ico]) => (
                  <a key={name} href="#" className="w-9 h-9 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center hover:bg-white/10 transition" aria-label={name}>{ico}</a>
                ))}
              </div>
            </div>

            <FooterCol title="Servicios" items={[
              ['Eléctricas', '#servicios'], ['Climatización', '#servicios'], ['Fotovoltaica', '#servicios'],
              ['Cargadores VE', '#servicios'], ['Domótica', '#servicios'],
            ]} />
            <FooterCol title="Empresa" items={[
              ['Sobre nosotros', '#empresa'], ['Proyectos', '#proyectos'], ['Blog', '#blog'],
              ['Trabaja con nosotros', '#'], ['Contacto', '#contacto'],
            ]} />
            <FooterCol title="Legal" items={[
              ['Aviso legal', '#'], ['Privacidad', '#'], ['Cookies', '#'], ['Condiciones', '#'],
            ]} />
          </div>

          <div className="pt-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 text-xs text-white/50 border-t border-white/10">
            <div>© 2026 JS Electric S.L. · CIF B12345678 · Todos los derechos reservados.</div>
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 spark-dot"></span>
              <span>Aceptando proyectos · Próxima cita en 3 días</span>
            </div>
          </div>
        </div>
      </footer>

      {/* Toast */}
      <div className={`toast ${toast.show ? 'show' : ''} fixed bottom-6 left-1/2 -translate-x-1/2 ${toast.ok ? 'bg-ink-900' : 'bg-red-700'} text-white px-5 py-3 rounded-full shadow-lift z-50 text-sm flex items-center gap-2`}>
        <svg className="w-4 h-4 text-spark-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
        <span>{toast.msg || '¡Solicitud enviada! Te llamaremos pronto.'}</span>
      </div>
    </div>
  )
}

// ── Subcomponentes (datos repetitivos, no abstracciones prematuras) ──

function ServiceCard({ num, title, desc, bullets, icon, delay = 0 }) {
  return (
    <article className={`svc-card group relative bg-white rounded-2xl p-7 border border-ink-900/8 shadow-soft reveal ${delay ? `reveal-delay-${delay}` : ''}`}>
      <div className="flex items-start justify-between mb-8">
        <div className="svc-icon-wrap w-14 h-14 rounded-xl bg-electric-50 text-electric-700 flex items-center justify-center">{icon}</div>
        <span className="num-tag font-mono text-xs text-ink-700/50">/ {num}</span>
      </div>
      <h3 className="font-display text-2xl font-semibold mb-2">{title}</h3>
      <p className="text-ink-700 text-sm leading-relaxed mb-5">{desc}</p>
      <ul className="space-y-1.5 text-sm text-ink-800 mb-6">
        {bullets.map((b) => (
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

function ServiceCardHighlight({ num, icon, delay = 0 }) {
  return (
    <article className={`svc-card group relative bg-electric-500 text-white rounded-2xl p-7 border border-electric-500 shadow-electric reveal ${delay ? `reveal-delay-${delay}` : ''} overflow-hidden`}>
      <div className="absolute inset-0 opacity-30 grid-bg pointer-events-none"></div>
      <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-white/15 blur-2xl"></div>
      <div className="absolute -bottom-12 -left-8 w-32 h-32 rounded-full bg-electric-300/30 blur-2xl"></div>
      <div className="relative">
        <div className="flex items-start justify-between mb-8">
          <div className="w-14 h-14 rounded-xl bg-white text-electric-600 flex items-center justify-center">{icon}</div>
          <span className="num-tag font-mono text-xs text-white/50">/ {num}</span>
        </div>
        <span className="inline-block px-2.5 py-0.5 rounded-full bg-spark-400 text-ink-900 text-[10px] font-semibold uppercase tracking-wider mb-3">★ Más solicitado</span>
        <h3 className="font-display text-2xl font-semibold mb-2 tracking-tight">Placas solares</h3>
        <p className="text-white/85 text-sm leading-relaxed mb-5">
          Autoconsumo fotovoltaico llave en mano. Estudio, legalización, tramitación de ayudas y monitorización 24/7.
        </p>
        <ul className="space-y-1.5 text-sm text-white/90 mb-6">
          {['Residencial e industrial', 'Baterías y vertido', 'Subvenciones Next Gen'].map((b) => (
            <li key={b} className="flex items-center gap-2"><span className="w-1 h-1 rounded-full bg-white"></span>{b}</li>
          ))}
        </ul>
        <a href="#calculadora" className="inline-flex items-center gap-1.5 text-sm font-semibold text-white group-hover:gap-2.5 transition-all">
          Calcular ahorro
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M13 5l7 7-7 7" /></svg>
        </a>
      </div>
    </article>
  )
}

function ProjectCard({ cls, img, kicker, title, desc, featured = false, delay = 0 }) {
  return (
    <div className={`gallery-item reveal ${delay ? `reveal-delay-${delay}` : ''} ${cls} relative rounded-2xl overflow-hidden group`}>
      <img src={img} alt={title} className="absolute inset-0 w-full h-full object-cover" />
      <div className="absolute inset-0 bg-gradient-to-t from-ink-900 via-ink-900/30 to-transparent"></div>
      <div className="absolute bottom-0 left-0 right-0 p-6 sm:p-7">
        <div className={`uppercase tracking-widest text-electric-400 mb-1 sm:mb-2 ${featured ? 'text-xs' : 'text-[10px]'}`}>{kicker}</div>
        <h3 className={`font-display font-semibold tracking-tight ${featured ? 'text-3xl mb-1' : 'text-xl'}`}>{title}</h3>
        {desc && <p className="text-white/70 text-sm max-w-md">{desc}</p>}
      </div>
    </div>
  )
}

function Testimonial({ text, name, role, avatar, avatarCls, delay = 0 }) {
  return (
    <figure className={`reveal ${delay ? `reveal-delay-${delay}` : ''} bg-white rounded-2xl p-7 border border-ink-900/5 shadow-soft`}>
      <svg className="w-8 h-8 text-spark-500 mb-4" viewBox="0 0 24 24" fill="currentColor"><path d="M9 7H5a2 2 0 00-2 2v4a2 2 0 002 2h2v3a2 2 0 002 2V7zm10 0h-4a2 2 0 00-2 2v4a2 2 0 002 2h2v3a2 2 0 002 2V7z" /></svg>
      <blockquote className="font-display text-lg leading-relaxed text-ink-900 mb-6">"{text}"</blockquote>
      <figcaption className="flex items-center gap-3 pt-4 border-t border-ink-900/5">
        <div className={`w-10 h-10 rounded-full flex items-center justify-center font-display font-semibold ${avatarCls}`}>{avatar}</div>
        <div>
          <div className="font-medium text-sm">{name}</div>
          <div className="text-xs text-ink-700">{role}</div>
        </div>
      </figcaption>
    </figure>
  )
}

function Value({ title, desc, icon }) {
  return (
    <div className="flex gap-4">
      <div className="w-11 h-11 rounded-xl bg-electric-500 text-white flex items-center justify-center flex-shrink-0">{icon}</div>
      <div>
        <h3 className="font-display font-semibold mb-1">{title}</h3>
        <p className="text-sm text-ink-700">{desc}</p>
      </div>
    </div>
  )
}

function BlogPost({ img, kicker, title, excerpt, delay = 0 }) {
  return (
    <article className={`reveal ${delay ? `reveal-delay-${delay}` : ''} group`}>
      <a href="#" className="block rounded-2xl overflow-hidden mb-5 aspect-[4/3] relative">
        <img src={img} alt="" className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" />
      </a>
      <div className="text-[10px] uppercase tracking-widest text-electric-600 font-mono mb-2">{kicker}</div>
      <h3 className="font-display text-xl font-semibold leading-snug mb-2 group-hover:text-electric-700 transition">{title}</h3>
      <p className="text-sm text-ink-700">{excerpt}</p>
    </article>
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

function FooterCol({ title, items }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-widest text-white/50 mb-4">{title}</div>
      <ul className="space-y-2.5 text-sm">
        {items.map(([label, href]) => (
          <li key={label}><a href={href} className="hover:text-white transition">{label}</a></li>
        ))}
      </ul>
    </div>
  )
}
