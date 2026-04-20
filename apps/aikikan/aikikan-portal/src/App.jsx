import useScrollReveal from './hooks/useScrollReveal.js'
import Cursor from './components/Cursor.jsx'
import Nav from './components/Nav.jsx'
import Hero from './components/Hero.jsx'
import VideoBanner from './components/VideoBanner.jsx'
import PullQuote from './components/PullQuote.jsx'
import Masters from './components/Masters.jsx'
import Videos from './components/Videos.jsx'
import About from './components/About.jsx'
import Dojos from './components/Dojos.jsx'
import Events from './components/Events.jsx'
import Recognition from './components/Recognition.jsx'
import Contact from './components/Contact.jsx'
import Footer from './components/Footer.jsx'

export default function App() {
  useScrollReveal()

  return (
    <>
      <Cursor />
      <Nav />
      <Hero />
      <PullQuote />
      <Recognition />
      <About />
      <Masters />
      <Videos />
      <Contact />
      <Dojos />
      <Footer />
    </>
  )
}
