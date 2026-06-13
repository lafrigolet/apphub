import { useState, useEffect } from 'react'
import { productos, categorias } from '../data/content.js'
import { Leaf, Bag, Arrow } from './icons.jsx'
import { useCart } from '../context/CartContext.jsx'
import { useSession } from '../context/SessionContext.jsx'

const PAGINA = 6

// Bonos reales (package_templates del seed): se compran con el flujo de bono
// (commerce + payments → saldo de sesiones), no como producto de la cesta.
const BONO_TEMPLATES = {
  p15: { templateId: '70000004-0000-0000-0000-000000000001', amountCents: 6000 },
  p16: { templateId: '70000004-0000-0000-0000-000000000002', amountCents: 11000 },
}

// Degradado del "tile" de producto por categoría (clases literales → Tailwind las
// detecta). Placeholder mientras no haya fotos reales.
const TILE = {
  esterillas: 'from-teal-500/25 to-salvia-400/15',
  props: 'from-salvia-400/30 to-niebla',
  ropa: 'from-teal-600/20 to-teal-500/5',
  bienestar: 'from-salvia-500/25 to-crema',
  bonos: 'from-teal-500/20 to-salvia-400/25',
}
const NOMBRE_CAT = Object.fromEntries(categorias.map((c) => [c.id, c.nombre]))

const precioTexto = (p) => (p.desde ? `desde ${p.precio} €` : `${p.precio} €`)

export default function Tienda() {
  const { addOne } = useCart()
  const { comprar } = useSession()
  const [cat, setCat] = useState('todas')
  const [visibles, setVisibles] = useState(PAGINA)

  // Al cambiar de categoría, vuelve a la primera "página".
  useEffect(() => { setVisibles(PAGINA) }, [cat])

  const filtrados = cat === 'todas' ? productos : productos.filter((p) => p.categoria === cat)
  const mostrados = filtrados.slice(0, visibles)
  const hayMas = visibles < filtrados.length

  return (
    <section id="tienda" className="relative py-24 sm:py-32">
      <div className="max-w-7xl mx-auto px-5 sm:px-8">
        {/* Cabecera */}
        <div className="grid lg:grid-cols-12 gap-8 mb-10">
          <div className="lg:col-span-6 reveal">
            <p className="eyebrow">— 06 / Tienda</p>
            <h2 className="display text-4xl sm:text-5xl lg:text-6xl mt-4">
              La <em>tienda</em> del estudio.
            </h2>
          </div>
          <div className="lg:col-span-5 lg:col-start-8 flex items-end reveal reveal-delay-1">
            <p className="text-lg text-tinta/75 leading-relaxed">
              Esterillas, props, ropa y bienestar elegidos con cuidado. Filtra por categoría y
              añade a la cesta lo que quieras.
            </p>
          </div>
        </div>

        {/* Filtro por categoría */}
        <div className="flex flex-wrap gap-2 mb-8 reveal">
          {[{ id: 'todas', nombre: 'Todo' }, ...categorias].map((c) => (
            <button
              key={c.id}
              onClick={() => setCat(c.id)}
              className={`text-sm font-semibold rounded-full px-4 py-1.5 border transition-colors ${
                cat === c.id ? 'bg-teal-600 text-crema border-teal-600' : 'border-tinta/15 text-tinta/65 hover:border-teal-500 hover:text-teal-600'
              }`}
            >
              {c.nombre}
            </button>
          ))}
        </div>

        {/* Rejilla de productos */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {mostrados.map((p) => (
            <article key={p.id} className="card-zen card-lift overflow-hidden flex flex-col">
              {/* Tile placeholder (gradiente + hoja). TODO: foto real */}
              <div className={`relative aspect-[4/3] bg-gradient-to-br ${TILE[p.categoria] ?? 'from-niebla to-crema'} flex items-center justify-center`}>
                <Leaf className="w-12 h-12 text-teal-700/30" />
                {p.badge && (
                  <span className="absolute top-3 left-3 text-[11px] font-semibold uppercase tracking-widest text-teal-700 bg-crema/85 backdrop-blur rounded-full px-3 py-1">
                    {p.badge}
                  </span>
                )}
              </div>
              <div className="p-5 flex flex-col flex-1">
                <span className="text-[11px] uppercase tracking-widest text-tinta/40 font-semibold">{NOMBRE_CAT[p.categoria]}</span>
                <h3 className="font-semibold text-tinta mt-1 leading-snug">{p.nombre}</h3>
                <p className="text-sm text-tinta/60 leading-relaxed mt-1.5">{p.desc}</p>
                <div className="flex items-center justify-between mt-4 pt-4 border-t border-tinta/8">
                  <span className="display text-2xl text-teal-700">{precioTexto(p)}</span>
                  {BONO_TEMPLATES[p.id] ? (
                    <button
                      onClick={() => comprar({ ...BONO_TEMPLATES[p.id], nombre: p.nombre })}
                      className="btn-zen btn-fill !py-2 !px-4 text-[13px]">
                      Comprar bono
                    </button>
                  ) : (
                    <button
                      onClick={() => addOne({ itemId: p.id, name: p.nombre, priceCents: Math.round(p.precio * 100) })}
                      className="btn-zen btn-outline !py-2 !px-4 text-[13px]">
                      <Bag className="w-4 h-4" /> Añadir
                    </button>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>

        {/* Paginación + contador */}
        <div className="flex flex-col items-center gap-3 mt-12">
          <p className="text-sm text-tinta/50">Mostrando {mostrados.length} de {filtrados.length}</p>
          {hayMas && (
            <button onClick={() => setVisibles((v) => v + PAGINA)} className="btn-zen btn-fill">
              Cargar más <Arrow className="w-4 h-4 rotate-90" />
            </button>
          )}
        </div>
      </div>
    </section>
  )
}
