import { useEffect, useRef, useState } from 'react'
import { useReveal, useCounters, useHeaderShadow } from '../hooks/index.js'
import Header      from '../components/Header.jsx'
import Hero        from '../components/Hero.jsx'
import Servicios   from '../components/Servicios.jsx'
import Proyectos   from '../components/Proyectos.jsx'
import Calculadora from '../components/Calculadora.jsx'
import Testimonios from '../components/Testimonios.jsx'
import Empresa     from '../components/Empresa.jsx'
import Blog        from '../components/Blog.jsx'
import Contacto    from '../components/Contacto.jsx'
import Footer      from '../components/Footer.jsx'
import Toast       from '../components/Toast.jsx'

export default function Landing() {
  useReveal()
  useCounters()
  useHeaderShadow()

  const [toast, setToast] = useState({ msg: '', show: false, ok: true })
  const toastTimer = useRef(null)
  const showToast = (msg, ok = true) => {
    setToast({ msg, ok, show: true })
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast((t) => ({ ...t, show: false })), 3500)
  }
  useEffect(() => () => toastTimer.current && clearTimeout(toastTimer.current), [])

  return (
    <div className="bg-bone text-ink-900 antialiased">
      <Header />
      <Hero />
      <Servicios />
      <Proyectos />
      <Calculadora showToast={showToast} />
      <Testimonios />
      <Empresa />
      <Blog />
      <Contacto showToast={showToast} />
      <Footer />
      <Toast msg={toast.msg} show={toast.show} ok={toast.ok} />
    </div>
  )
}
