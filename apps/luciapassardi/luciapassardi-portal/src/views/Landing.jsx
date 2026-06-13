import { useState, useEffect } from 'react'
import { useReveal, useHeaderShadow } from '../hooks/index.js'
import Header from '../components/Header.jsx'
import Hero from '../components/Hero.jsx'
import Clases from '../components/Clases.jsx'
import RetirosTalleres from '../components/RetirosTalleres.jsx'
import Enfoque from '../components/Enfoque.jsx'
import SobreMi from '../components/SobreMi.jsx'
import Contacto from '../components/Contacto.jsx'
import Footer from '../components/Footer.jsx'

const VARIANTES_VALIDAS = ['strip', 'bento', 'card']

export default function Landing() {
  useReveal()
  useHeaderShadow()

  // Variante del hero, elegible desde el control del menú y persistida.
  const [heroVariant, setHeroVariant] = useState(() => {
    try {
      const v = localStorage.getItem('lp_hero')
      return VARIANTES_VALIDAS.includes(v) ? v : 'strip'
    } catch { return 'strip' }
  })
  useEffect(() => {
    try { localStorage.setItem('lp_hero', heroVariant) } catch { /* ignore */ }
  }, [heroVariant])

  return (
    <div className="bg-piedra text-tinta antialiased">
      <Header variant={heroVariant} onVariant={setHeroVariant} />
      <main>
        <Hero variant={heroVariant} />
        <Clases />
        <RetirosTalleres />
        <Enfoque />
        <SobreMi />
        <Contacto />
      </main>
      <Footer />
    </div>
  )
}
