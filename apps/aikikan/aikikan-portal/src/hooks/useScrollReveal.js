import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

// Observer que añade `.visible` a las secciones .reveal/.stagger cuando
// entran al viewport. Hay que reconfigurarlo en CADA cambio de ruta:
// React desmonta los <section className="reveal"> al navegar fuera de
// la landing (p.ej. /consola) y los remonta al volver, pero los nodos
// nuevos no están registrados en el observer original — sin esto, las
// secciones se quedan invisibles tras navegar.
export default function useScrollReveal() {
  const location = useLocation()
  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible') }),
      { threshold: 0.08 },
    )
    // setTimeout 0 deja que React termine el commit y los nodos nuevos
    // estén en el DOM antes del querySelectorAll.
    const t = setTimeout(() => {
      document.querySelectorAll('.reveal, .stagger').forEach(el => observer.observe(el))
    }, 0)
    return () => { clearTimeout(t); observer.disconnect() }
  }, [location.pathname])
}
