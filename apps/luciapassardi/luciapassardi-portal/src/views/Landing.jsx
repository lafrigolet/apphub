import { useReveal, useHeaderShadow } from '../hooks/index.js'
import Header from '../components/Header.jsx'
import Hero from '../components/Hero.jsx'
import Clases from '../components/Clases.jsx'
import RetirosTalleres from '../components/RetirosTalleres.jsx'
import Enfoque from '../components/Enfoque.jsx'
import SobreMi from '../components/SobreMi.jsx'
import Contacto from '../components/Contacto.jsx'
import Footer from '../components/Footer.jsx'

export default function Landing() {
  useReveal()
  useHeaderShadow()

  return (
    <div className="bg-piedra text-tinta antialiased">
      <Header />
      <main>
        <Hero />
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
