const benefits = [
  { icon: '🧘', title: 'Todos los niveles', desc: 'Desde principiante absoluto hasta practicante avanzado, tenemos clases para ti.' },
  { icon: '📅', title: 'Horarios flexibles', desc: 'Mañana, tarde y noche. Más de 30 clases semanales para que elijas las que mejor te vienen.' },
  { icon: '👥', title: 'Grupos reducidos', desc: 'Máximo 15 personas por clase para una atención personalizada de calidad.' },
  { icon: '🏆', title: 'Instructores certificados', desc: 'Todo nuestro equipo cuenta con formación RYT 200/500 y años de experiencia.' },
  { icon: '🎯', title: 'Plan a tu medida', desc: 'Bonos de clase individuales, mensuales o trimestrales. Paga solo lo que usas.' },
  { icon: '✨', title: 'Comunidad', desc: 'Talleres, retiros y eventos especiales que van más allá de la esterilla.' },
]

export default function Benefits() {
  return (
    <section className="py-20 bg-white">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-12">
          <h2 className="font-serif text-4xl font-bold text-sage-900 mb-4">¿Por qué Serenity Yoga?</h2>
          <p className="text-sage-600 max-w-xl mx-auto">Más que un gimnasio, una comunidad que te acompaña en tu práctica.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {benefits.map(b => (
            <div key={b.title} className="p-6 rounded-2xl bg-sand-50 hover:shadow-md transition-shadow">
              <div className="text-3xl mb-4">{b.icon}</div>
              <h3 className="font-semibold text-sage-900 mb-2">{b.title}</h3>
              <p className="text-sm text-sage-600 leading-relaxed">{b.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
