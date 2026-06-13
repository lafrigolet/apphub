import { useEffect, useState } from 'react'
import { proximosEventos as EVENTOS_FALLBACK, horario as HORARIO_FALLBACK } from '../data/content.js'
import { fetchUpcoming, toEvento, sessionsToHorario } from '../lib/studio.js'

// Próximos eventos: en vivo (services/sessions kind=event) con fallback estático.
export function useProximosEventos() {
  const [eventos, setEventos] = useState(EVENTOS_FALLBACK)
  useEffect(() => {
    let cancel = false
    fetchUpcoming('event', 8)
      .then((rows) => { if (!cancel && rows?.length) setEventos(rows.map(toEvento)) })
      .catch(() => {})
    return () => { cancel = true }
  }, [])
  return eventos
}

// Horario semanal: en vivo (sessions kind=appointment) con fallback estático.
export function useHorarioLive() {
  const [dias, setDias] = useState(HORARIO_FALLBACK)
  useEffect(() => {
    let cancel = false
    fetchUpcoming('appointment', 300)
      .then((rows) => {
        if (cancel || !rows?.length) return
        const grid = sessionsToHorario(rows)
        if (grid.some((d) => d.clases.length)) setDias(grid)
      })
      .catch(() => {})
    return () => { cancel = true }
  }, [])
  return dias
}

// Fade-up al entrar en viewport: añade .visible a los .reveal.
export function useReveal() {
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('visible')
            io.unobserve(e.target)
          }
        })
      },
      { threshold: 0.14 },
    )
    document.querySelectorAll('.reveal').forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])
}

// Sombra/blur del header al hacer scroll.
export function useHeaderShadow() {
  useEffect(() => {
    const header = document.getElementById('site-header')
    if (!header) return
    const onScroll = () => header.classList.toggle('scrolled', window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
}
