const instructors = [
  { name: 'Ana Martínez', specialty: 'Hatha & Yin Yoga', years: 8, initials: 'AM', color: 'bg-sage-100 text-sage-700' },
  { name: 'Carlos Vega', specialty: 'Vinyasa & Power', years: 6, initials: 'CV', color: 'bg-warm-100 text-warm-700' },
  { name: 'Laura Sánchez', specialty: 'Restaurativo & Mindfulness', years: 10, initials: 'LS', color: 'bg-sand-200 text-sand-700' },
  { name: 'Sergio Torres', specialty: 'Ashtanga & Avanzado', years: 12, initials: 'ST', color: 'bg-blue-100 text-blue-700' },
]

export default function Instructors() {
  return (
    <section id="instructores" className="py-20 bg-white">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-12">
          <h2 className="font-serif text-4xl font-bold text-sage-900 mb-4">Nuestro equipo</h2>
          <p className="text-sage-600">Instructores apasionados, comprometidos con tu práctica.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
          {instructors.map(i => (
            <div key={i.name} className="text-center">
              <div className={`w-20 h-20 rounded-full flex items-center justify-center text-2xl font-bold mx-auto mb-4 ${i.color}`}>
                {i.initials}
              </div>
              <h3 className="font-semibold text-sage-900">{i.name}</h3>
              <p className="text-sm text-sage-600 mt-1">{i.specialty}</p>
              <p className="text-xs text-sage-400 mt-1">{i.years} años de experiencia</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
