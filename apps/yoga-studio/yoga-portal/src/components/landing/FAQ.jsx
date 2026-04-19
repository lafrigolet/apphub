import { useState } from 'react'

const faqs = [
  { q: '¿Necesito experiencia previa para apuntarme?', a: 'No, en absoluto. Tenemos clases de nivel principiante donde te enseñamos todo desde cero.' },
  { q: '¿Qué necesito traer a clase?', a: 'Solo ropa cómoda. Las esterillas, bloques y props están disponibles en el estudio.' },
  { q: '¿Con cuánta antelación debo reservar?', a: 'Puedes reservar hasta con 7 días de antelación. Te recomendamos reservar con al menos 24h.' },
  { q: '¿Puedo cancelar una reserva?', a: 'Sí, puedes cancelar hasta 2 horas antes de la clase y el crédito vuelve a tu bono.' },
  { q: '¿Los bonos tienen fecha de caducidad?', a: 'El bono de 10 clases caduca a los 3 meses. El mensual se renueva cada mes.' },
]

export default function FAQ() {
  const [open, setOpen] = useState(null)
  return (
    <section className="py-20 bg-sand-50">
      <div className="max-w-2xl mx-auto px-6">
        <h2 className="font-serif text-4xl font-bold text-sage-900 text-center mb-12">Preguntas frecuentes</h2>
        <div className="space-y-3">
          {faqs.map((f, i) => (
            <div key={i} className="bg-white rounded-xl overflow-hidden shadow-sm">
              <button
                className="w-full text-left px-5 py-4 font-medium text-sage-900 flex justify-between items-center gap-4"
                onClick={() => setOpen(open === i ? null : i)}
              >
                <span>{f.q}</span>
                <span className="text-sage-500 text-lg flex-shrink-0">{open === i ? '−' : '+'}</span>
              </button>
              {open === i && (
                <div className="px-5 pb-4 text-sm text-sage-700 leading-relaxed border-t border-sand-100 pt-3">
                  {f.a}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
