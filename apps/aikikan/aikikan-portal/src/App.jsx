import { useState } from 'react'
import useScrollReveal from './hooks/useScrollReveal.js'
import Cursor from './components/Cursor.jsx'
import Nav from './components/Nav.jsx'
import Hero from './components/Hero.jsx'
import PullQuote from './components/PullQuote.jsx'
import Masters from './components/Masters.jsx'
import Videos from './components/Videos.jsx'
import About from './components/About.jsx'
import Dojos from './components/Dojos.jsx'
import Events from './components/Events.jsx'
import Recognition from './components/Recognition.jsx'
import Contact from './components/Contact.jsx'
import Footer from './components/Footer.jsx'
import Login from './components/Login.jsx'

export default function App() {
  useScrollReveal()
  const [loginOpen, setLoginOpen] = useState(false)

  return (
    <>
      <Cursor />
      <Nav onLoginOpen={() => setLoginOpen(true)} />
      <Hero />
      <PullQuote />
      <Recognition />
      <About />
      <Masters />
      <Videos />
      <Events />
      <Contact />
      <Dojos />
      <Footer />
      {loginOpen && <Login onClose={() => setLoginOpen(false)} />}
    </>
  )
}
