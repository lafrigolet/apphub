import { useEffect } from 'react'

// IntersectionObserver añade .visible a cualquier elemento con .reveal.
// Se ejecuta una vez al montar; la animación es CSS-only (ver index.css).
export function useReveal() {
  useEffect(() => {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add('visible')
          io.unobserve(e.target)
        }
      })
    }, { threshold: 0.12 })
    document.querySelectorAll('.reveal').forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])
}

// Anima los .counter desde 0 hasta data-target cuando entran al viewport.
export function useCounters() {
  useEffect(() => {
    const counterIO = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return
        const el = e.target
        const target = +el.dataset.target
        const dur = 1600
        const t0 = performance.now()
        const step = (t) => {
          const p = Math.min((t - t0) / dur, 1)
          const eased = 1 - Math.pow(1 - p, 3)
          el.textContent = Math.round(eased * target).toLocaleString('es-ES')
          if (p < 1) requestAnimationFrame(step)
        }
        requestAnimationFrame(step)
        counterIO.unobserve(el)
      })
    }, { threshold: 0.5 })
    document.querySelectorAll('.counter').forEach((el) => counterIO.observe(el))
    return () => counterIO.disconnect()
  }, [])
}

// Añade .shadow-soft al header cuando el scroll pasa de 8px.
export function useHeaderShadow() {
  useEffect(() => {
    const header = document.getElementById('site-header')
    if (!header) return
    const onScroll = () => {
      if (window.scrollY > 8) header.classList.add('shadow-soft')
      else header.classList.remove('shadow-soft')
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
}
