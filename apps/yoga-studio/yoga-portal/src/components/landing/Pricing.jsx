import Button from '../ui/Button.jsx'

const plans = [
  { name: 'Clase suelta', price: 18, unit: 'por clase', features: ['Acceso a cualquier clase', 'Sin compromiso', 'Reserva online'], highlight: false },
  { name: 'Bono 10 clases', price: 150, unit: '3 meses de validez', features: ['Ahorra 30€', 'Clases de cualquier tipo', 'Reserva con antelación', 'Cancelación hasta 2h antes'], highlight: true },
  { name: 'Mensual ilimitado', price: 85, unit: 'por mes', features: ['Clases ilimitadas', 'Talleres con descuento', 'Prioridad en reservas', 'Acceso a grabaciones'], highlight: false },
]

export default function Pricing({ onRegister }) {
  return (
    <section id="precios" className="py-20 bg-sand-50">
      <div className="max-w-5xl mx-auto px-6">
        <div className="text-center mb-12">
          <h2 className="font-serif text-4xl font-bold text-sage-900 mb-4">Precios</h2>
          <p className="text-sage-600">Planes transparentes, sin sorpresas. IVA incluido.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {plans.map(p => (
            <div key={p.name} className={`rounded-2xl p-8 flex flex-col ${p.highlight ? 'bg-sage-700 text-white shadow-xl scale-105' : 'bg-white shadow-sm'}`}>
              <h3 className={`font-serif text-xl font-bold mb-2 ${p.highlight ? 'text-white' : 'text-sage-900'}`}>{p.name}</h3>
              <div className="mb-1">
                <span className={`text-4xl font-bold ${p.highlight ? 'text-white' : 'text-sage-800'}`}>{p.price}€</span>
              </div>
              <p className={`text-sm mb-6 ${p.highlight ? 'text-sage-200' : 'text-sage-500'}`}>{p.unit}</p>
              <ul className="space-y-2 mb-8 flex-1">
                {p.features.map(f => (
                  <li key={f} className={`text-sm flex items-center gap-2 ${p.highlight ? 'text-sage-100' : 'text-sage-700'}`}>
                    <span className={p.highlight ? 'text-warm-300' : 'text-sage-500'}>✓</span>
                    {f}
                  </li>
                ))}
              </ul>
              <Button
                variant={p.highlight ? 'secondary' : 'primary'}
                className={p.highlight ? 'border-white text-sage-700' : ''}
                onClick={onRegister}
              >
                Empezar
              </Button>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
