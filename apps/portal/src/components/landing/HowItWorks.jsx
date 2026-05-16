const STEPS = [
  {
    n: 1,
    title: 'Cuéntanos qué necesitas',
    desc:  'Una llamada de 30 min para entender tu negocio y los flujos que quieres digitalizar.',
  },
  {
    n: 2,
    title: 'Activamos los módulos',
    desc:  'Configuramos auth, pagos, reservas, etc. en tu tenant y conectamos con tu web actual.',
  },
  {
    n: 3,
    title: 'Operativo en días',
    desc:  'Tu web tiene la nueva funcionalidad. Tú gestionas el día a día desde el panel.',
  },
]

export default function HowItWorks() {
  return (
    <section className="py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-600">
            Cómo funciona
          </p>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
            De llamada inicial a producción en días, no meses
          </h2>
        </div>

        <ol className="mt-14 grid gap-8 sm:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.n} className="relative">
              {/* Connector line between steps on >=sm. Cosmetic only. */}
              {i < STEPS.length - 1 && (
                <span
                  aria-hidden
                  className="absolute left-12 top-5 hidden h-px w-full bg-slate-200 sm:block"
                />
              )}
              <div className="relative flex h-10 w-10 items-center justify-center rounded-full bg-indigo-600 font-semibold text-white">
                {s.n}
              </div>
              <h3 className="mt-5 text-lg font-semibold text-slate-900">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{s.desc}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
