import { hero, contacto, fotos } from '../data/content.js'
import { fmtFecha } from '../lib/fecha.js'
import { useProximosEventos } from '../hooks/index.js'
import { Arrow } from './icons.jsx'

// Variante "bento": rejilla que llena la pantalla (100svh). Izquierda el texto;
// derecha la foto (celda flexible) + un panel de agenda. Todo equilibrado para
// caber junto al cargar.
export default function HeroBento() {
  const proximosEventos = useProximosEventos()
  return (
    <section id="inicio" className="relative overflow-hidden min-h-[100svh] flex items-center pt-[72px]">
      <div className="absolute inset-0 wash-salvia opacity-80" aria-hidden="true" />

      <div className="relative max-w-7xl mx-auto w-full px-5 sm:px-8 py-8">
        <div className="grid lg:grid-cols-12 gap-6 lg:gap-8 lg:h-[calc(100svh-72px-4rem)] lg:max-h-[800px]">
          {/* Texto */}
          <div className="lg:col-span-5 flex flex-col justify-center load-in load-1">
            <p className="eyebrow">{hero.kicker}</p>
            <h1 className="display text-5xl sm:text-6xl mt-4">
              {hero.titleLead} <em>{hero.titleEm}</em><br />
              <span className="text-tinta/90">{hero.titleTail}</span>
            </h1>
            <p className="display text-3xl text-teal-600 italic mt-5">{hero.lema}</p>
            <p className="text-lg text-tinta/75 leading-relaxed mt-5">{hero.intro}</p>
            <div className="flex flex-wrap gap-3 mt-8">
              <a href={contacto.whatsappMsg} target="_blank" rel="noopener noreferrer" className="btn-zen btn-fill">
                Reserva una clase <Arrow className="w-4 h-4" />
              </a>
              <a href="#clases" className="btn-zen btn-outline">Ver clases</a>
            </div>
          </div>

          {/* Derecha: foto (flexible) + panel de agenda */}
          <div className="lg:col-span-7 flex flex-col gap-5 min-h-0">
            <div className="relative flex-1 min-h-[220px] rounded-[2rem] overflow-hidden shadow-lift bg-niebla load-in load-2">
              <img src={fotos.hero} alt="Práctica de yoga" className="w-full h-full object-cover" loading="eager" />
              <div className="absolute bottom-4 left-4 bg-crema/90 backdrop-blur rounded-2xl px-4 py-2.5 shadow-soft flex items-center gap-2.5">
                <span className="w-2.5 h-2.5 rounded-full bg-teal-500 breathe-dot" />
                <span className="text-sm font-medium text-tinta">Clases íntimas en {contacto.zona}</span>
              </div>
            </div>

            <div className="card-zen p-5 sm:p-6 load-in load-3">
              <div className="flex items-center justify-between mb-3">
                <p className="eyebrow">Próximos eventos</p>
                <a href="#retiros" className="text-sm font-semibold text-teal-700 hover:text-teal-600 inline-flex items-center gap-1.5">
                  Ver agenda <Arrow className="w-3.5 h-3.5" />
                </a>
              </div>
              <ul className="grid sm:grid-cols-2 gap-x-8 gap-y-1">
                {proximosEventos.slice(0, 4).map((e) => {
                  const { dia, mes, anio } = fmtFecha(e.date)
                  return (
                    <li key={e.id}>
                      <a href="#retiros" className="group grid grid-cols-[auto_1fr] items-center gap-3 py-2.5 border-b border-tinta/8">
                        <span className="text-center leading-none">
                          <span className="display block text-xl text-teal-600">{dia}</span>
                          <span className="block text-[10px] font-semibold tracking-widest text-tinta/45">{mes} {anio}</span>
                        </span>
                        <span className="min-w-0">
                          <span className="block font-semibold text-tinta text-[15px] truncate">{e.name}</span>
                          <span className="block text-xs text-tinta/55 truncate">{e.location}</span>
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
    </section>
  )
}
