import { pilares, valores } from '../data/content.js'

export default function Enfoque() {
  return (
    <section id="enfoque" className="relative py-24 sm:py-32">
      <div className="max-w-7xl mx-auto px-5 sm:px-8">
        <div className="max-w-3xl reveal">
          <p className="eyebrow">— 03 / Mi enfoque</p>
          <h2 className="display text-4xl sm:text-5xl lg:text-6xl mt-4">
            No sólo ejercicio físico: un método para la <em>autorregulación</em>.
          </h2>
          <p className="text-lg text-tinta/75 leading-relaxed mt-6">
            Cada clase teje tres hilos —postura, respiración y atención— para que el yoga sea
            también una forma de cuidarte por dentro.
          </p>
        </div>

        {/* Pilares */}
        <div className="grid sm:grid-cols-3 gap-6 mt-14">
          {pilares.map((p, i) => (
            <div key={p.title} className={`card-zen p-8 reveal ${i ? `reveal-delay-${i}` : ''}`}>
              <div className="display text-5xl text-salvia-500/60 mb-3">0{i + 1}</div>
              <h3 className="display text-3xl mb-2">{p.title}</h3>
              <p className="text-tinta/70 leading-relaxed">{p.desc}</p>
            </div>
          ))}
        </div>

        <div className="hairline my-16" />

        {/* Valores */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-10">
          {valores.map((v, i) => (
            <div key={v.title} className={`reveal ${`reveal-delay-${i % 4}`}`}>
              <span className="block w-9 h-px bg-teal-500 mb-4" />
              <h4 className="display text-2xl mb-1.5">{v.title}</h4>
              <p className="text-tinta/70 text-[15px] leading-relaxed">{v.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
