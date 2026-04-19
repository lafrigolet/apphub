const items = [
  { name: 'María G.', text: 'Llevo 2 años practicando aquí y ha transformado mi vida. Los instructores son increíbles y el ambiente es muy acogedor.' },
  { name: 'Roberto M.', text: 'Empecé sin saber nada de yoga y ahora no concibo una semana sin mis clases. La app para reservar es superfácil.' },
  { name: 'Sofía L.', text: 'El bono de 10 clases es una ganga. La flexibilidad de horarios me permite combinar el yoga con el trabajo.' },
]

export default function Testimonials() {
  return (
    <section className="py-20 bg-white">
      <div className="max-w-5xl mx-auto px-6">
        <div className="text-center mb-12">
          <h2 className="font-serif text-4xl font-bold text-sage-900 mb-4">Lo que dicen nuestros alumnos</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {items.map(t => (
            <div key={t.name} className="bg-sand-50 rounded-2xl p-6">
              <p className="text-sage-700 italic leading-relaxed mb-4">"{t.text}"</p>
              <p className="text-sm font-semibold text-sage-900">{t.name}</p>
              <div className="flex gap-0.5 mt-1">{'★★★★★'.split('').map((s, i) => <span key={i} className="text-warm-400 text-sm">{s}</span>)}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
