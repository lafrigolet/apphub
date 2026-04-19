import Button from '../ui/Button.jsx'

export default function Hero({ onRegister }) {
  return (
    <section className="hero-bg min-h-screen flex items-center justify-center text-center px-6 pt-16">
      <div className="max-w-3xl">
        <span className="inline-block text-sage-600 text-sm font-semibold tracking-widest uppercase mb-4">
          Estudio de Yoga • Madrid
        </span>
        <h1 className="font-serif text-5xl md:text-7xl font-bold text-sage-900 leading-tight mb-6">
          Encuentra tu<br />
          <span className="text-sage-600 italic">equilibrio interior</span>
        </h1>
        <p className="text-lg text-sage-700 mb-10 max-w-xl mx-auto leading-relaxed">
          Clases de yoga para todos los niveles. Instructores certificados, ambiente cálido y
          horarios flexibles adaptados a tu ritmo de vida.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Button size="lg" onClick={onRegister}>Empieza gratis hoy</Button>
          <Button variant="secondary" size="lg" onClick={() => document.getElementById('clases')?.scrollIntoView({ behavior: 'smooth' })}>
            Ver clases
          </Button>
        </div>
        <div className="mt-16 grid grid-cols-3 gap-8 max-w-md mx-auto">
          {[['500+', 'Alumnos activos'], ['12', 'Instructores'], ['30+', 'Clases semanales']].map(([n, l]) => (
            <div key={l} className="text-center">
              <div className="font-serif text-3xl font-bold text-sage-800">{n}</div>
              <div className="text-xs text-sage-600 mt-1">{l}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
