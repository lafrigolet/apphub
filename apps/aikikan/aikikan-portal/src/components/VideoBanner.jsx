import { useEffect, useRef } from 'react'

export default function VideoBanner() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    let rafId
    let tick = 0

    const resize = () => {
      canvas.width = canvas.offsetWidth
      canvas.height = canvas.offsetHeight
    }
    resize()
    window.addEventListener('resize', resize)

    const draw = () => {
      const w = canvas.width, h = canvas.height
      ctx.fillStyle = 'rgba(244,239,230,0.06)'
      ctx.fillRect(0, 0, w, h)
      tick += 0.003

      for (let i = 0; i < 6; i++) {
        const t = tick + i * 1.1
        const x = w * (0.5 + 0.45 * Math.cos(t * 0.18 + i * 0.8))
        const y = h * (0.5 + 0.45 * Math.sin(t * 0.14 + i * 0.6))
        const x2 = w * (0.5 + 0.42 * Math.cos(t * 0.21 + i))
        const y2 = h * (0.5 + 0.42 * Math.sin(t * 0.19 + i * 0.9))
        const g = ctx.createLinearGradient(x, y, x2, y2)
        g.addColorStop(0, 'rgba(244,67,54,0.018)')
        g.addColorStop(0.5, 'rgba(244,67,54,0.055)')
        g.addColorStop(1, 'rgba(244,67,54,0.008)')
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.bezierCurveTo(
          w * Math.sin(t * 0.11 + i * 0.4), h * Math.cos(t * 0.13),
          w * Math.cos(t * 0.08 + i), h * Math.sin(t * 0.12 + i * 0.5),
          x2, y2
        )
        ctx.strokeStyle = g
        ctx.lineWidth = 1.8 + Math.sin(t) * 0.8
        ctx.stroke()
      }

      for (let i = 0; i < 3; i++) {
        const t = (tick * 0.4 + i * 2.1) % (Math.PI * 2)
        const r = Math.min(w, h) * (0.08 + 0.22 * (t / (Math.PI * 2)))
        const alpha = 0.06 * (1 - t / (Math.PI * 2))
        ctx.beginPath()
        ctx.arc(w * 0.72, h * 0.5, r, 0, Math.PI * 2)
        ctx.strokeStyle = `rgba(244,67,54,${alpha})`
        ctx.lineWidth = 1
        ctx.stroke()
      }

      rafId = requestAnimationFrame(draw)
    }
    rafId = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(rafId)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return (
    <div id="video-banner">
      <canvas id="vb-canvas" ref={canvasRef}></canvas>
      <div className="vb-overlay"></div>
      <div className="vb-top"></div>
      <div className="vb-bot"></div>
      <div className="vb-content">
        <p className="vb-label reveal"><span className="slash">/</span> El camino del budo</p>
        <h2 className="vb-title reveal">EL ARTE<br />DE LA<br />ARMONÍA</h2>
        <p className="vb-sub reveal">La técnica como espejo del espíritu — aikido, vía de paz.</p>
      </div>
    </div>
  )
}
