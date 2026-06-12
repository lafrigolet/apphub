import { retiros, contacto, fotos } from '../data/content.js'
import { Arrow } from './icons.jsx'

export default function RetirosTalleres() {
  return (
    <section id="retiros" className="relative py-24 sm:py-32 wash-soft">
      <div className="max-w-7xl mx-auto px-5 sm:px-8">
        <div className="grid lg:grid-cols-12 gap-10 lg:gap-14 items-center">
          {/* Imagen */}
          <div className="lg:col-span-5 reveal">
            <div className="relative">
              <div className="blob blob-drift absolute -top-6 -right-6 w-36 h-36 bg-salvia-400/30" aria-hidden="true" />
              <div className="blob overflow-hidden shadow-lift aspect-square bg-niebla">
                <img src={fotos.retiro} alt="Retiro de yoga en la naturaleza"
                  className="w-full h-full object-cover" loading="lazy" />
              </div>
            </div>
          </div>

          {/* Lista */}
          <div className="lg:col-span-7">
            <p className="eyebrow reveal">— 02 / Retiros y talleres</p>
            <h2 className="display text-4xl sm:text-5xl mt-4 mb-8 reveal reveal-delay-1">
              Parar, respirar, <em>reconectar</em>.
            </h2>
            <div className="space-y-4">
              {retiros.map((r, i) => (
                <div key={r.title}
                  className={`card-zen p-6 sm:p-7 flex items-start gap-5 reveal ${i ? `reveal-delay-${i}` : ''}`}>
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-1.5">
                      <h3 className="display text-2xl">{r.title}</h3>
                      <span className="text-[11px] font-semibold uppercase tracking-widest text-salvia-600 bg-salvia-400/20 rounded-full px-2.5 py-0.5">
                        {r.tag}
                      </span>
                    </div>
                    <p className="text-tinta/70 leading-relaxed">{r.desc}</p>
                  </div>
                </div>
              ))}
            </div>
            <a href={contacto.whatsappMsg} target="_blank" rel="noopener noreferrer"
              className="btn-zen btn-fill mt-8 reveal reveal-delay-3">
              ¡Toda la info aquí! <Arrow className="w-4 h-4" />
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}
