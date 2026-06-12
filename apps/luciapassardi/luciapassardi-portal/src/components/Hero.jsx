import { hero, contacto, fotos } from '../data/content.js'
import { Arrow } from './icons.jsx'

export default function Hero() {
  return (
    <section id="inicio" className="relative overflow-hidden pt-[72px]">
      {/* Lavado de color de fondo */}
      <div className="absolute inset-0 wash-salvia opacity-80" aria-hidden="true" />
      <div className="relative max-w-7xl mx-auto px-5 sm:px-8 pt-16 sm:pt-24 pb-20 sm:pb-28">
        <div className="grid lg:grid-cols-12 gap-12 items-center">
          {/* Texto */}
          <div className="lg:col-span-6">
            <p className="eyebrow reveal">{hero.kicker}</p>
            <h1 className="display text-5xl sm:text-6xl lg:text-7xl mt-5 reveal reveal-delay-1">
              {hero.titleLead} <em>{hero.titleEm}</em><br />
              <span className="text-tinta/90">{hero.titleTail}</span>
            </h1>
            <p className="display text-3xl sm:text-4xl text-teal-600 italic mt-6 reveal reveal-delay-2">
              {hero.lema}
            </p>
            <p className="text-lg text-tinta/75 leading-relaxed max-w-xl mt-6 reveal reveal-delay-2">
              {hero.intro}
            </p>
            <div className="flex flex-wrap gap-3 mt-9 reveal reveal-delay-3">
              <a href={contacto.whatsappMsg} target="_blank" rel="noopener noreferrer" className="btn-zen btn-fill">
                Reserva una clase <Arrow className="w-4 h-4" />
              </a>
              <a href="#clases" className="btn-zen btn-outline">Ver clases</a>
            </div>
          </div>

          {/* Visual: blob con foto + blobs decorativos */}
          <div className="lg:col-span-6 relative reveal reveal-delay-2">
            <div className="relative mx-auto max-w-md lg:max-w-none">
              <div className="blob blob-drift absolute -top-6 -left-6 w-40 h-40 bg-teal-500/20" aria-hidden="true" />
              <div className="blob blob-drift absolute -bottom-8 -right-4 w-48 h-48 bg-salvia-400/30"
                style={{ animationDelay: '-6s' }} aria-hidden="true" />
              <div className="blob overflow-hidden shadow-lift aspect-[4/5] bg-niebla">
                <img src={fotos.hero} alt="Práctica de yoga"
                  className="w-full h-full object-cover" loading="eager" />
              </div>
              <div className="absolute bottom-5 left-5 bg-crema/90 backdrop-blur rounded-2xl px-4 py-3 shadow-soft flex items-center gap-2.5">
                <span className="w-2.5 h-2.5 rounded-full bg-teal-500 breathe-dot" />
                <span className="text-sm font-medium text-tinta">Clases íntimas en {contacto.zona}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
