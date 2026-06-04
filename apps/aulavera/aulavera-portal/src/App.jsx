import { useEffect } from 'react'
import { Routes, Route, useLocation } from 'react-router-dom'
import Nav from './components/Nav'
import Footer from './components/Footer'
import CookiesBanner from './components/CookiesBanner'
import { ToastProvider } from './components/Toast'
import Home from './views/Home'
import Areas from './views/Areas'
import Proyectos from './views/Proyectos'
import Contacto from './views/Contacto'
import Privada from './views/Privada'
import GrafoHome from './views/grafocaligrafia/GrafoHome'
import GrafoTecnica from './views/grafocaligrafia/GrafoTecnica'
import GrafoMetodo from './views/grafocaligrafia/GrafoMetodo'
import GrafoZurdos from './views/grafocaligrafia/GrafoZurdos'
import GrafoRecursos from './views/grafocaligrafia/GrafoRecursos'
import GrafoCurso from './views/grafocaligrafia/GrafoCurso'

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    if (pathname !== '/donar') window.scrollTo({ top: 0, behavior: 'instant' })
  }, [pathname])
  return null
}

export default function App() {
  return (
    <ToastProvider>
      <ScrollToTop />
      <Nav />
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/areas" element={<Areas />} />
          <Route path="/proyectos" element={<Proyectos />} />
          <Route path="/contacto" element={<Contacto />} />
          <Route path="/donar" element={<Contacto />} />
          <Route path="/privada" element={<Privada />} />
          <Route path="/grafocaligrafia" element={<GrafoHome />} />
          <Route path="/grafocaligrafia/tecnica" element={<GrafoTecnica />} />
          <Route path="/grafocaligrafia/metodo" element={<GrafoMetodo />} />
          <Route path="/grafocaligrafia/zurdos" element={<GrafoZurdos />} />
          <Route path="/grafocaligrafia/recursos" element={<GrafoRecursos />} />
          <Route path="/grafocaligrafia/curso" element={<GrafoCurso />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </main>
      <Footer />
      <CookiesBanner />
    </ToastProvider>
  )
}
