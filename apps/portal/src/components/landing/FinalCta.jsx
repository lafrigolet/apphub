export default function FinalCta({ onOpenDemo }) {
  return (
    <section className="py-20 sm:py-24">
      <div className="mx-auto max-w-5xl px-6">
        <div className="overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-700 to-violet-800 px-10 py-14 text-center shadow-xl sm:px-16 sm:py-16">
          <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            ¿Listo para añadir funcionalidad a tu negocio?
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-indigo-100">
            Cuéntanos qué necesitas. Te respondemos en menos de 48 horas con
            una propuesta de qué módulos encajan y cuánto tarda activarlos.
          </p>
          <div className="mt-8">
            <button
              type="button"
              onClick={onOpenDemo}
              className="rounded-md bg-white px-6 py-3 text-base font-semibold text-indigo-700 shadow-sm transition hover:bg-indigo-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-indigo-700"
            >
              Solicita una demo gratis →
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
