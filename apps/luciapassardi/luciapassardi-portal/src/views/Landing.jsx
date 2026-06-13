import { useReveal, useHeaderShadow } from '../hooks/index.js'
import Header from '../components/Header.jsx'
import HeroCard from '../components/HeroCard.jsx'
import Clases from '../components/Clases.jsx'
import Horario from '../components/Horario.jsx'
import RetirosTalleres from '../components/RetirosTalleres.jsx'
import Enfoque from '../components/Enfoque.jsx'
import SobreMi from '../components/SobreMi.jsx'
import Tienda from '../components/Tienda.jsx'
import Contacto from '../components/Contacto.jsx'
import Footer from '../components/Footer.jsx'

export default function Landing() {
  useReveal()
  useHeaderShadow()

  return (
    <div className="bg-piedra text-tinta antialiased">
      <Header />
      <main>
        <HeroCard />
        <Clases />
        <Horario />
        <RetirosTalleres />
        <Enfoque />
        <SobreMi />
        <Tienda />
        <Contacto />
      </main>
      <Footer />
    </div>
  )
}
