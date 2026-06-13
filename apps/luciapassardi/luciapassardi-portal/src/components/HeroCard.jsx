import { hero, contacto, fotos, proximosEventos } from '../data/content.js'
import { fmtFecha } from '../lib/fecha.js'
import { Arrow } from './icons.jsx'

// Variante "tarjeta flotante": el hero se mantiene compacto y la agenda vive en
// una tarjeta translúcida superpuesta a la foto. Cambio mínimo respecto al hero
// original; la agenda queda visible junto a la foto al cargar.
export default function HeroCard() {
  return (
    <section id="inicio" className="relative overflow-hidden pt-[72px]">
      <div className="absolute inset-0 wash-salvia opacity-80" aria-hidden="true" />
      <div className="relative max-w-7xl mx-auto px-5 sm:px-8 pt-14 sm:pt-20 pb-16">
        <div className="grid lg:grid-cols-12 gap-12 items-center">
          {/* Texto */}
          <div className="lg:col-span-6">
            <p className="eyebrow load-in load-1">{hero.kicker}</p>
            <h1 className="display text-5xl sm:text-6xl lg:text-7xl mt-5 load-in load-2">
              {hero.titleLead} <em>{hero.titleEm}</em><br />
              <span className="text-tinta/90">{hero.titleTail}</span>
            </h1>
            <p className="display text-3xl sm:text-4xl text-teal-600 italic mt-6 load-in load-3">{hero.lema}</p>
            <p className="text-lg text-tinta/75 leading-relaxed max-w-xl mt-6 load-in load-3">{hero.intro}</p>
            <div className="flex flex-wrap gap-3 mt-9 load-in load-4">
              <a href={contacto.whatsappMsg} target="_blank" rel="noopener noreferrer" className="btn-zen btn-fill">
                Reserva una clase <Arrow className="w-4 h-4" />
              </a>
              <a href="#clases" className="btn-zen btn-outline">Ver clases</a>
            </div>
          </div>

          {/* Foto + tarjeta de agenda flotante */}
          <div className="lg:col-span-6 relative load-in load-3">
            <div className="relative mx-auto max-w-md lg:max-w-none lg:pb-16 lg:pr-10">
              <div className="blob blob-drift absolute -top-6 -left-6 w-40 h-40 bg-teal-500/20" aria-hidden="true" />
              <div className="blob overflow-hidden shadow-lift aspect-[4/5] bg-niebla">
                <img src={fotos.hero} alt="Práctica de yoga" className="w-full h-full object-cover" loading="eager" />
              </div>

              {/* Tarjeta glass de agenda — superpuesta en desktop, apilada en móvil */}
              <div className="glass rounded-3xl shadow-lift p-5 mt-5 lg:mt-0 lg:absolute lg:bottom-0 lg:right-0 lg:w-[20rem] load-in load-5">
                <div className="flex items-center justify-between mb-2.5">
                  <p className="eyebrow">Próximos eventos</p>
                  <a href="#retiros" className="text-xs font-semibold text-teal-700 hover:text-teal-600">Ver agenda →</a>
                </div>
                <ul className="divide-y divide-tinta/10">
                  {proximosEventos.slice(0, 3).map((e) => {
                    const { dia, mes, anio } = fmtFecha(e.date)
                    return (
                      <li key={e.id}>
                        <a href="#retiros" className="group grid grid-cols-[auto_1fr_auto] items-center gap-3 py-2.5">
                          <span className="text-center leading-none">
                            <span className="display block text-xl text-teal-600">{dia}</span>
                            <span className="block text-[10px] font-semibold tracking-widest text-tinta/45">{mes} {anio}</span>
                          </span>
                          <span className="min-w-0">
                            <span className="block font-semibold text-tinta text-sm truncate">{e.name}</span>
                            <span className="block text-xs text-tinta/55 truncate">{e.location}</span>
                          </span>
                          <span className="text-teal-600 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Arrow className="w-4 h-4" />
                          </span>
                        </a>
                      </li>
                    )
                  })}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
