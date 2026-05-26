import { Star, SvgIcon } from './icons.jsx'
import { valores } from '../data/mock.js'

export default function Empresa() {
  return (
    <section id="empresa" className="relative py-24 sm:py-32">
      <div className="max-w-7xl mx-auto px-5 sm:px-8">
        <div className="grid lg:grid-cols-12 gap-12 items-center">
          <div className="lg:col-span-5 reveal order-2 lg:order-1">
            <div className="relative">
              <div className="rounded-3xl overflow-hidden shadow-lift">
                <img src="https://images.unsplash.com/photo-1581094794329-c8112a89af12?auto=format&fit=crop&w=900&q=80" alt="Equipo JS Electric" className="w-full h-[480px] object-cover" />
              </div>
              <div className="absolute -bottom-6 -right-4 sm:-right-8 bg-white rounded-2xl p-5 shadow-lift border border-ink-900/5 max-w-[240px]">
                <div className="flex items-center gap-1 mb-2">
                  <Star className="w-4 h-4 text-spark-500" />
                  <span className="font-display text-sm font-semibold">Equipo certificado</span>
                </div>
                <p className="text-xs text-ink-700">12 técnicos titulados, carnet RITE y BT con formación continua.</p>
              </div>
            </div>
          </div>

          <div className="lg:col-span-6 lg:col-start-7 reveal reveal-delay-1 order-1 lg:order-2">
            <div className="text-xs uppercase tracking-[0.2em] text-electric-600 font-mono mb-4">— 05 / Empresa</div>
            <h2 className="display text-4xl sm:text-5xl lg:text-6xl font-semibold leading-[1.02] mb-8">
              Una empresa <em>local</em>,<br />con visión global.
            </h2>
            <p className="text-lg text-ink-700 leading-relaxed mb-6">
              Desde 2009 ayudamos a familias, comunidades y empresas a tomar el control
              de su energía. Empezamos con un electricista y una furgoneta; hoy somos
              un equipo de <strong className="text-ink-900">28 personas</strong> que diseña, instala y mantiene proyectos
              en toda la península.
            </p>
            <p className="text-ink-700 leading-relaxed mb-10">
              Lo que no ha cambiado: trato cercano, presupuestos transparentes
              y un compromiso real con la transición energética.
            </p>

            <div className="grid sm:grid-cols-2 gap-5">
              {valores.map((v) => (
                <div key={v.title} className="flex gap-4">
                  <div className="w-11 h-11 rounded-xl bg-electric-500 text-white flex items-center justify-center flex-shrink-0">
                    <SvgIcon d={v.iconPath} className="w-5 h-5 ico" />
                  </div>
                  <div>
                    <h3 className="font-display font-semibold mb-1">{v.title}</h3>
                    <p className="text-sm text-ink-700">{v.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
