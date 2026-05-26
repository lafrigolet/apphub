import { projects } from '../data/mock.js'

export default function Proyectos() {
  return (
    <section id="proyectos" className="relative py-24 sm:py-32 bg-ink-900 text-white overflow-hidden grain">
      <div className="absolute inset-0 grid-bg opacity-40 pointer-events-none"></div>
      <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-electric-500/40 blur-3xl rounded-full pointer-events-none"></div>

      <div className="relative max-w-7xl mx-auto px-5 sm:px-8 z-10">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-8 mb-14">
          <div className="reveal max-w-2xl">
            <div className="text-xs uppercase tracking-[0.2em] text-electric-400 font-mono mb-4">— 02 / Proyectos</div>
            <h2 className="display text-4xl sm:text-5xl lg:text-6xl font-semibold leading-[1.02]">
              Algunos trabajos<br />que nos hacen <em>brillar</em>.
            </h2>
          </div>
          <p className="reveal reveal-delay-1 text-white/70 max-w-md">
            De viviendas unifamiliares a naves industriales con cubierta solar de 250kWp.
            Cada proyecto, una solución a medida.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-6 gap-4 sm:gap-5">
          {projects.map((p, idx) => (
            <ProjectCard key={p.title} project={p} delay={idx % 3} />
          ))}
        </div>
      </div>
    </section>
  )
}

function ProjectCard({ project, delay }) {
  const { cls, img, kicker, title, desc, featured = false } = project
  return (
    <div className={`gallery-item reveal ${delay ? `reveal-delay-${delay}` : ''} ${cls} relative rounded-2xl overflow-hidden group`}>
      <img src={img} alt={title} className="absolute inset-0 w-full h-full object-cover" />
      <div className="absolute inset-0 bg-gradient-to-t from-ink-900 via-ink-900/30 to-transparent"></div>
      <div className="absolute bottom-0 left-0 right-0 p-6 sm:p-7">
        <div className={`uppercase tracking-widest text-electric-400 mb-1 sm:mb-2 ${featured ? 'text-xs' : 'text-[10px]'}`}>{kicker}</div>
        <h3 className={`font-display font-semibold tracking-tight ${featured ? 'text-3xl mb-1' : 'text-xl'}`}>{title}</h3>
        {desc && <p className="text-white/70 text-sm max-w-md">{desc}</p>}
      </div>
    </div>
  )
}
