import { useState } from 'react'
import { horario, ubicaciones, horarioNota, contacto } from '../data/content.js'
import { Arrow } from './icons.jsx'

const UBIC = Object.fromEntries(ubicaciones.map((u) => [u.id, u]))

export default function Horario() {
  const [loc, setLoc] = useState('todas')
  const visible = (c) => loc === 'todas' || c.ubicacion === loc

  return (
    <section id="horario" className="relative py-24 sm:py-32 wash-soft">
      <div className="max-w-7xl mx-auto px-5 sm:px-8">
        {/* Cabecera */}
        <div className="grid lg:grid-cols-12 gap-8 mb-10">
          <div className="lg:col-span-6 reveal">
            <p className="eyebrow">— 02 / Horario</p>
            <h2 className="display text-4xl sm:text-5xl lg:text-6xl mt-4">
              Calendario de <em>clases</em> semanales.
            </h2>
          </div>
          <div className="lg:col-span-5 lg:col-start-8 flex items-end reveal reveal-delay-1">
            <p className="text-lg text-tinta/75 leading-relaxed">
              De lunes a domingo, en varias ubicaciones. Filtra por dónde te viene mejor practicar.
            </p>
          </div>
        </div>

        {/* Filtro por ubicación */}
        <div className="flex flex-wrap gap-2 mb-8 reveal">
          <button
            onClick={() => setLoc('todas')}
            className={`text-sm font-semibold rounded-full px-4 py-1.5 border transition-colors ${
              loc === 'todas' ? 'bg-teal-600 text-crema border-teal-600' : 'border-tinta/15 text-tinta/65 hover:border-teal-500 hover:text-teal-600'
            }`}
          >
            Todas
          </button>
          {ubicaciones.map((u) => (
            <button
              key={u.id}
              onClick={() => setLoc(u.id)}
              className={`inline-flex items-center gap-2 text-sm font-semibold rounded-full px-4 py-1.5 border transition-colors ${
                loc === u.id ? 'bg-teal-600 text-crema border-teal-600' : 'border-tinta/15 text-tinta/65 hover:border-teal-500 hover:text-teal-600'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${loc === u.id ? 'bg-crema' : u.dot}`} />
              {u.nombre}
            </button>
          ))}
        </div>

        {/* Cuadrante semanal — 7 columnas en desktop, apilado en móvil */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3 reveal">
          {horario.map((d) => {
            const clases = d.clases.filter(visible)
            return (
              <div key={d.dia} className="flex flex-col">
                <div className="flex items-baseline justify-between lg:justify-center gap-2 pb-2 mb-3 border-b-2 border-tinta/10">
                  <span className="display text-xl text-tinta">{d.corto}</span>
                  <span className="text-[11px] uppercase tracking-widest text-tinta/40 font-semibold lg:hidden">{d.dia}</span>
                </div>

                <div className="flex flex-col gap-2.5">
                  {clases.length === 0 && (
                    <p className="text-[13px] text-tinta/35 italic py-2">Descanso</p>
                  )}
                  {clases.map((c, i) => {
                    const u = UBIC[c.ubicacion]
                    return (
                      <div key={`${c.hora}-${i}`} className={`card-zen p-3 ${u.soft}`}>
                        <div className="flex items-center justify-between">
                          <span className="display text-lg text-teal-700">{c.hora}</span>
                          <span className="text-[10px] text-tinta/45">{c.dur}′</span>
                        </div>
                        <p className="font-semibold text-sm text-tinta leading-snug mt-0.5">{c.tipo}</p>
                        <p className="text-[11px] text-tinta/55">{c.nivel}</p>
                        <div className="flex items-center gap-1.5 mt-2">
                          <span className={`w-2 h-2 rounded-full shrink-0 ${u.dot}`} />
                          <span className={`text-[11px] leading-tight ${u.text}`}>{u.nombre}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>

        {/* Nota + CTA */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mt-10 reveal">
          <p className="text-sm text-tinta/55 max-w-xl">{horarioNota}</p>
          <a href={contacto.whatsappMsg} target="_blank" rel="noopener noreferrer" className="btn-zen btn-outline shrink-0">
            Consultar plaza <Arrow className="w-4 h-4" />
          </a>
        </div>
      </div>
    </section>
  )
}
