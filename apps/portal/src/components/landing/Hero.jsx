export default function Hero({ onOpenDemo }) {
  return (
    <section className="relative overflow-hidden">
      {/* Subtle indigo radial glow behind the headline — adds depth without
         pulling attention. Lives in a stacking context below the content. */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 -z-10 h-full bg-[radial-gradient(ellipse_at_top,rgba(99,102,241,0.18),transparent_60%)]"
      />

      <div className="mx-auto max-w-3xl px-6 pt-24 pb-20 text-center sm:pt-32 sm:pb-28">
        <p className="mb-5 text-xs font-semibold uppercase tracking-[0.18em] text-indigo-600">
          Plataforma para tu negocio
        </p>
        <h1 className="text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl">
          Funcionalidad web para tu negocio.
        </h1>
        <p className="mt-6 text-lg leading-relaxed text-slate-600">
          Reservas, pagos, gestión de socios, citas — añadidos a tu web actual
          sin reemplazarla. Hulkstein activa los módulos que necesitas y los
          mantiene operativos.
        </p>

        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
          <button
            type="button"
            onClick={onOpenDemo}
            className="rounded-md bg-indigo-600 px-6 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
          >
            Solicita una demo gratis →
          </button>
          <a
            href="#industrias"
            className="text-sm font-medium text-slate-600 transition hover:text-slate-900"
          >
            Ver casos de uso
          </a>
        </div>

        <p className="mt-6 text-xs text-slate-500">
          Sin compromiso · respondemos en menos de 48 horas
        </p>
      </div>
    </section>
  )
}
