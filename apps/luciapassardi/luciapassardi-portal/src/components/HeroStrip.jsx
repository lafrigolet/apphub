import { hero, contacto, fotos, proximosEventos } from '../data/content.js'
import { fmtFecha } from '../lib/fecha.js'
import { Arrow } from './icons.jsx'

// Variante "tira": hero a 100svh con texto+foto arriba y una franja horizontal
// de eventos anclada abajo. Todo entra en el viewport al cargar.
export default function HeroStrip() {
  return (
    <section id="inicio" className="relative overflow-hidden min-h-[100svh] flex flex-col pt-[72px]">
      <div className="absolute inset-0 wash-salvia opacity-80" aria-hidden="true" />

      <div className="relative flex-1 flex items-center">
        <div className="max-w-7xl mx-auto w-full px-5 sm:px-8 py-8">
          <div className="grid lg:grid-cols-12 gap-10 items-center">
            <div className="lg:col-span-7">
              <p className="eyebrow load-in load-1">{hero.kicker}</p>
              <h1 className="display text-5xl sm:text-6xl lg:text-7xl mt-4 load-in load-2">
                {hero.titleLead} <em>{hero.titleEm}</em><br />
                <span className="text-tinta/90">{hero.titleTail}</span>
              </h1>
              <p className="display text-3xl sm:text-4xl text-teal-600 italic mt-5 load-in load-3">{hero.lema}</p>
              <p className="text-lg text-tinta/75 leading-relaxed max-w-xl mt-5 load-in load-3">{hero.intro}</p>
              <div className="flex flex-wrap gap-3 mt-8 load-in load-4">
                <a href={contacto.whatsappMsg} target="_blank" rel="noopener noreferrer" className="btn-zen btn-fill">
                  Reserva una clase <Arrow className="w-4 h-4" />
                </a>
                <a href="#clases" className="btn-zen btn-outline">Ver clases</a>
              </div>
            </div>

            <div className="lg:col-span-5 load-in load-3">
              <div className="relative mx-auto max-w-[15rem] sm:max-w-xs">
                <div className="blob blob-drift absolute -top-5 -right-5 w-28 h-28 bg-salvia-400/30" aria-hidden="true" />
                <div className="blob overflow-hidden shadow-lift aspect-[4/5] bg-niebla">
                  <img src={fotos.hero} alt="Práctica de yoga" className="w-full h-full object-cover" loading="eager" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Tira de agenda anclada abajo */}
      <div className="relative border-t border-tinta/10 bg-crema/55 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto w-full px-5 sm:px-8 py-5">
          <div className="flex items-center justify-between mb-3 load-in load-4">
            <p className="eyebrow">Próximos eventos</p>
            <a href="#retiros" className="text-sm font-semibold text-teal-700 hover:text-teal-600 inline-flex items-center gap-1.5">
              Ver agenda <Arrow className="w-3.5 h-3.5" />
            </a>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1 snap-x">
            {proximosEventos.map((e, i) => {
              const { dia, mes, anio } = fmtFecha(e.date)
              return (
                <a key={e.id} href="#retiros"
                  className={`evento-chip card-zen shrink-0 w-60 p-4 flex items-center gap-3 snap-start load-in load-${Math.min(i + 3, 6)}`}>
                  <span className="text-center leading-none shrink-0">
                    <span className="display block text-2xl text-teal-600">{dia}</span>
                    <span className="block text-[10px] font-semibold tracking-widest text-tinta/45">{mes} {anio}</span>
                  </span>
                  <span className="min-w-0">
                    <span className="block font-semibold text-tinta truncate">{e.name}</span>
                    <span className="block text-xs text-tinta/55 truncate">{e.location}</span>
                  </span>
                </a>
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
}
