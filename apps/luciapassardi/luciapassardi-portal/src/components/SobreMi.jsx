import { credenciales, contacto, fotos } from '../data/content.js'

export default function SobreMi() {
  return (
    <section id="sobre-mi" className="relative py-24 sm:py-32 wash-soft">
      <div className="max-w-7xl mx-auto px-5 sm:px-8">
        <div className="grid lg:grid-cols-12 gap-12 lg:gap-16 items-center">
          {/* Retrato */}
          <div className="lg:col-span-5 reveal">
            <div className="relative max-w-sm mx-auto lg:mx-0">
              <div className="blob blob-drift absolute -bottom-6 -left-6 w-40 h-40 bg-teal-500/18" aria-hidden="true" />
              <div className="blob overflow-hidden shadow-lift aspect-[4/5] bg-niebla">
                <img src={fotos.sobreMi} alt="Lucía Passardi"
                  className="w-full h-full object-cover" loading="lazy" />
              </div>
            </div>
          </div>

          {/* Bio + credenciales */}
          <div className="lg:col-span-7">
            <p className="eyebrow reveal">— 05 / Conóceme</p>
            <h2 className="display text-4xl sm:text-5xl mt-4 reveal reveal-delay-1">
              Hola, soy <em>Lucía</em>.
            </h2>
            <p className="text-lg text-tinta/75 leading-relaxed mt-6 reveal reveal-delay-1">
              Profesora de yoga y movimiento desde 2011. Acompaño a cada persona a habitar su
              cuerpo con más conciencia y calma, dentro y fuera de la esterilla. Me formo de
              forma continua para cuidar el detalle de cada práctica.
            </p>

            <ul className="mt-9 space-y-4 reveal reveal-delay-2">
              {credenciales.map((c) => (
                <li key={c.year} className="flex gap-5">
                  <span className="display text-2xl text-teal-600 w-16 shrink-0">{c.year}</span>
                  <span className="text-tinta/80 leading-relaxed border-l border-tinta/12 pl-5">{c.text}</span>
                </li>
              ))}
            </ul>

            <a href={contacto.whatsappMsg} target="_blank" rel="noopener noreferrer"
              className="btn-zen btn-outline mt-10 reveal reveal-delay-3">
              Practica conmigo
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}
