import { useState } from 'react'
import Nav from '../components/landing/Nav.jsx'
import Hero from '../components/landing/Hero.jsx'
import Benefits from '../components/landing/Benefits.jsx'
import ClassesCatalog from '../components/landing/ClassesCatalog.jsx'
import Instructors from '../components/landing/Instructors.jsx'
import Pricing from '../components/landing/Pricing.jsx'
import Testimonials from '../components/landing/Testimonials.jsx'
import FAQ from '../components/landing/FAQ.jsx'
import Contact from '../components/landing/Contact.jsx'
import Footer from '../components/landing/Footer.jsx'
import LoginModal from '../features/auth/LoginModal.jsx'
import RegisterModal from '../features/auth/RegisterModal.jsx'

export default function LandingPage() {
  const [modal, setModal] = useState(null) // 'login' | 'register' | null

  return (
    <div className="min-h-screen bg-white font-sans">
      <Nav onLogin={() => setModal('login')} onRegister={() => setModal('register')} />
      <Hero onRegister={() => setModal('register')} />
      <Benefits />
      <ClassesCatalog />
      <Instructors />
      <Pricing onRegister={() => setModal('register')} />
      <Testimonials />
      <FAQ />
      <Contact />
      <Footer />
      <LoginModal
        open={modal === 'login'}
        onClose={() => setModal(null)}
        onSwitchToRegister={() => setModal('register')}
      />
      <RegisterModal
        open={modal === 'register'}
        onClose={() => setModal(null)}
        onSwitchToLogin={() => setModal('login')}
      />
    </div>
  )
}
