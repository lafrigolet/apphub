import { useState } from 'react'
import { ubicaciones, horarioNota, contacto } from '../data/content.js'
import { useHorarioLive } from '../hooks/index.js'
import { Arrow } from './icons.jsx'

// Meta de ubicación indexada por id (estático) Y por nombre (datos en vivo, que
// traen el nombre como texto libre), para etiqueta + color del punto.
const UBIC = {}
for (const u of ubicaciones) { UBIC[u.id] = u; UBIC[u.nombre] = u }

export default function Horario() {
  const dias = useHorarioLive()
  const [loc, setLoc] = useState('todas')

  // Opciones de filtro = ubicaciones distintas presentes en los datos (vivos o
  // estáticos), preservando un orden estable.
  const opciones = []
  const vistos = new Set()
  for (const d of dias) for (const c of d.clases) {
    if (c.ubicacion && !vistos.has(c.ubicacion)) { vistos.add(c.ubicacion); opciones.push(c.ubicacion) }
  }

  const visible = (c) => loc === 'todas' || c.ubicacion === loc
  const meta = (v) => UBIC[v] ?? { nombre: v, dot: 'bg-teal-600', text: 'text-teal-700', soft: 'bg-teal-500/10' }

  return (
    <section id="horario" className="relative py-24 sm:py-32 wash-soft">
      <div className="max-w-7xl mx-auto px-5 sm:px-8">
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

        <div className="flex flex-wrap gap-2 mb-8 reveal">
          <button onClick={() => setLoc('todas')}
            className={`text-sm font-semibold rounded-full px-4 py-1.5 border transition-colors ${
              loc === 'todas' ? 'bg-teal-600 text-crema border-teal-600' : 'border-tinta/15 text-tinta/65 hover:border-teal-500 hover:text-teal-600'}`}>
            Todas
          </button>
          {opciones.map((v) => {
            const u = meta(v)
            return (
              <button key={v} onClick={() => setLoc(v)}
                className={`inline-flex items-center gap-2 text-sm font-semibold rounded-full px-4 py-1.5 border transition-colors ${
                  loc === v ? 'bg-teal-600 text-crema border-teal-600' : 'border-tinta/15 text-tinta/65 hover:border-teal-500 hover:text-teal-600'}`}>
                <span className={`w-2 h-2 rounded-full ${loc === v ? 'bg-crema' : u.dot}`} />
                {u.nombre}
              </button>
            )
          })}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3 reveal">
          {dias.map((d) => {
            const clases = d.clases.filter(visible)
            return (
              <div key={d.dia} className="flex flex-col">
                <div className="flex items-baseline justify-between lg:justify-center gap-2 pb-2 mb-3 border-b-2 border-tinta/10">
                  <span className="display text-xl text-tinta">{d.corto}</span>
                  <span className="text-[11px] uppercase tracking-widest text-tinta/40 font-semibold lg:hidden">{d.dia}</span>
                </div>
                <div className="flex flex-col gap-2.5">
                  {clases.length === 0 && <p className="text-[13px] text-tinta/35 italic py-2">Descanso</p>}
                  {clases.map((c, i) => {
                    const u = meta(c.ubicacion)
                    return (
                      <div key={`${c.hora}-${i}`} className={`card-zen p-3 ${u.soft ?? ''}`}>
                        <div className="flex items-center justify-between">
                          <span className="display text-lg text-teal-700">{c.hora}</span>
                          {c.dur ? <span className="text-[10px] text-tinta/45">{c.dur}′</span> : null}
                        </div>
                        <p className="font-semibold text-sm text-tinta leading-snug mt-0.5">{c.tipo}</p>
                        {c.nivel ? <p className="text-[11px] text-tinta/55">{c.nivel}</p> : null}
                        <div className="flex items-center gap-1.5 mt-2">
                          <span className={`w-2 h-2 rounded-full shrink-0 ${u.dot}`} />
                          <span className={`text-[11px] leading-tight ${u.text ?? 'text-tinta/60'}`}>{u.nombre}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>

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
