const REASONS = [
  {
    title: 'No reemplaza tu web actual',
    desc:  'Hulkstein vive en tu propio subdominio y se integra como módulos. Tu home, tu marca, tu hosting — no se tocan.',
  },
  {
    title: 'Aislamiento multi-tenant',
    desc:  'Cada negocio es un tenant. Tus datos, configuración y permisos quedan separados del resto a nivel de base de datos.',
  },
  {
    title: 'Pagos seguros con Stripe',
    desc:  'Procesamos pagos con Stripe Connect: PSD2, splits a proveedores, refunds proporcionales, reconciliación fina.',
  },
  {
    title: 'APIs y webhooks',
    desc:  'Cada módulo expone una API documentada. Tu equipo técnico puede integrar tu CRM o tu ERP sin pedírnoslo.',
  },
]

export default function WhyUs() {
  return (
    <section className="border-y border-slate-100 bg-slate-50/60 py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-600">
            Por qué Hulkstein
          </p>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
            Diseñado para crecer contigo, no para reemplazarte
          </h2>
        </div>

        <dl className="mt-14 grid gap-x-10 gap-y-8 sm:grid-cols-2">
          {REASONS.map((r) => (
            <div key={r.title} className="flex gap-4">
              <span
                aria-hidden
                className="mt-1.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white"
              >
                <svg viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3">
                  <path
                    fillRule="evenodd"
                    d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 1 1 1.4-1.4l3.8 3.8 6.8-6.8a1 1 0 0 1 1.4 0Z"
                    clipRule="evenodd"
                  />
                </svg>
              </span>
              <div>
                <dt className="text-base font-semibold text-slate-900">{r.title}</dt>
                <dd className="mt-1.5 text-sm leading-relaxed text-slate-600">{r.desc}</dd>
              </div>
            </div>
          ))}
        </dl>
      </div>
    </section>
  )
}
