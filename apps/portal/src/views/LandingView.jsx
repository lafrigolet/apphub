import { useState } from 'react'
import Header from '../components/landing/Header'
import Hero from '../components/landing/Hero'
import Industries from '../components/landing/Industries'
import HowItWorks from '../components/landing/HowItWorks'
import WhyUs from '../components/landing/WhyUs'
import FinalCta from '../components/landing/FinalCta'
import Footer from '../components/landing/Footer'
import LeadModal from '../components/LeadModal'

export default function LandingView() {
  const [modalOpen, setModalOpen] = useState(false)
  const [modalSource, setModalSource] = useState('demo-cta')

  function openModal(source) {
    setModalSource(source)
    setModalOpen(true)
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Header onOpenDemo={() => openModal('header-cta')} />
      <main className="flex-1">
        <Hero onOpenDemo={() => openModal('hero-cta')} />
        <Industries />
        <HowItWorks />
        <WhyUs />
        <FinalCta onOpenDemo={() => openModal('final-cta')} />
      </main>
      <Footer />
      <LeadModal
        open={modalOpen}
        source={modalSource}
        onClose={() => setModalOpen(false)}
      />
    </div>
  )
}
