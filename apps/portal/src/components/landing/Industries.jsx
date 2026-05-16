// "Para quién" — 4 industry cards covering the platform monoliths we already
// have built: marketplace (shop), restaurant, appointments (services/citas),
// and the appointments-flavored gym/yoga vertical.
//
// Icons are inline SVG (no dependency) at 24×24, indigo-600 stroke. Cards use
// a one-line title, a 2-line description, and a thin bullet list of the
// concrete features each vertical gets from the platform.

const INDUSTRIES = [
  {
    key:   'restaurant',
    title: 'Restaurantes',
    desc:  'Reservas, menú online, pedidos a domicilio, KDS y POS — toda la operativa en una sola consola.',
    bullets: ['Menú online', 'Reservas + waitlist', 'POS y KDS', 'Delivery dispatch'],
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
        <path d="M3 11h18" />
        <path d="M5 11V8.5C5 6.5 6.5 5 8.5 5h7C17.5 5 19 6.5 19 8.5V11" />
        <path d="M6 11v4a4 4 0 0 0 4 4h4a4 4 0 0 0 4-4v-4" />
        <path d="M9 5V3M15 5V3" />
      </svg>
    ),
  },
  {
    key:   'gym',
    title: 'Gimnasios y estudios',
    desc:  'Clases programadas, packs de sesiones, cobros recurrentes y listas de espera.',
    bullets: ['Calendario de clases', 'Packs y bonos', 'Cuotas recurrentes', 'Waitlist con prioridad'],
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
        <path d="M6.5 6.5l11 11" />
        <path d="M21 21l-1.5-1.5" />
        <path d="M3 3l1.5 1.5" />
        <path d="M18 6l3 3-3 3" />
        <path d="M6 18l-3-3 3-3" />
      </svg>
    ),
  },
  {
    key:   'services',
    title: 'Servicios y citas',
    desc:  'Reservas profesionales, intake forms, telehealth y cobros — clínicas, asesores, terapeutas.',
    bullets: ['Citas online', 'Intake forms', 'Telehealth (video)', 'Comisiones a practicante'],
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M16 3v4M8 3v4M3 11h18" />
        <path d="M8 15h2M14 15h2M8 18h2" />
      </svg>
    ),
  },
  {
    key:   'shop',
    title: 'Tienda y marketplace',
    desc:  'Catálogo, carrito, envíos, devoluciones y reseñas — un marketplace completo para tu marca.',
    bullets: ['Catálogo + variantes', 'Carrito + checkout', 'Envíos multi-paquete', 'Reseñas verificadas'],
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
        <path d="M3 6h18l-1.5 11a2 2 0 0 1-2 1.7H6.5a2 2 0 0 1-2-1.7L3 6Z" />
        <path d="M8 6V4a4 4 0 0 1 8 0v2" />
      </svg>
    ),
  },
]

export default function Industries() {
  return (
    <section id="industrias" className="border-t border-slate-100 bg-slate-50/60 py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-600">
            Para quién
          </p>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
            Pensado para negocios reales
          </h2>
          <p className="mt-4 text-base leading-relaxed text-slate-600">
            Cuatro verticales, los módulos que cada uno necesita y nada más.
            Tu web se queda como está; nosotros añadimos la pieza que falta.
          </p>
        </div>

        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {INDUSTRIES.map((it) => (
            <article
              key={it.key}
              className="flex flex-col rounded-xl border border-slate-200 bg-white p-6 transition hover:border-indigo-200 hover:shadow-sm"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                {it.icon}
              </div>
              <h3 className="mt-5 text-lg font-semibold text-slate-900">{it.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{it.desc}</p>
              <ul className="mt-4 space-y-1.5 text-sm text-slate-600">
                {it.bullets.map((b) => (
                  <li key={b} className="flex items-start gap-2">
                    <span aria-hidden className="mt-1.5 inline-block h-1 w-1 shrink-0 rounded-full bg-indigo-500" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
