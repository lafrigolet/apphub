export default function Contact() {
  return (
    <section id="contacto" className="py-20 bg-white">
      <div className="max-w-4xl mx-auto px-6 grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
        <div>
          <h2 className="font-serif text-4xl font-bold text-sage-900 mb-4">Contáctanos</h2>
          <p className="text-sage-600 mb-6">¿Tienes alguna pregunta? Estaremos encantados de ayudarte.</p>
          <div className="space-y-3 text-sm text-sage-700">
            <p>📍 Calle del Bienestar 42, Madrid</p>
            <p>📞 +34 91 234 56 78</p>
            <p>📧 hola@serenityyoga.es</p>
            <p>🕐 Lun–Vie 7:00–22:00 · Sáb–Dom 9:00–20:00</p>
          </div>
        </div>
        <form className="space-y-4" onSubmit={e => e.preventDefault()}>
          <input
            type="text"
            placeholder="Tu nombre"
            className="w-full border border-sand-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sage-400"
          />
          <input
            type="email"
            placeholder="Tu email"
            className="w-full border border-sand-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sage-400"
          />
          <textarea
            placeholder="Tu mensaje"
            rows={4}
            className="w-full border border-sand-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sage-400 resize-none"
          />
          <button type="submit" className="w-full bg-sage-600 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-sage-700 transition-colors">
            Enviar mensaje
          </button>
        </form>
      </div>
    </section>
  )
}
