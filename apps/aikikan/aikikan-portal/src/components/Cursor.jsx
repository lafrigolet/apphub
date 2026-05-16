import { useEffect, useState } from 'react'

// Custom cursor (red dot + ring that follows the mouse). Disabled on touch
// devices: no mouse → cursor would sit at (0,0) and look broken, plus the
// global `cursor: none` would hide the OS finger highlight. Detection uses
// `pointer: coarse`, true on phones/tablets and false on desktops with a
// real pointing device.

function isTouchPrimary() {
  if (typeof window === 'undefined') return false
  return window.matchMedia?.('(pointer: coarse)').matches ?? false
}

export default function Cursor() {
  const [touch, setTouch] = useState(isTouchPrimary)

  // Re-evaluate on mql changes — e.g. user plugs in a mouse on a tablet.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mql = window.matchMedia('(pointer: coarse)')
    const onChange = () => setTouch(mql.matches)
    mql.addEventListener?.('change', onChange) ?? mql.addListener?.(onChange)
    return () => {
      mql.removeEventListener?.('change', onChange) ?? mql.removeListener?.(onChange)
    }
  }, [])

  useEffect(() => {
    if (touch) return
    const cursor = document.getElementById('cursor')
    const ring = document.getElementById('cursor-ring')
    if (!cursor || !ring) return
    let mx = 0, my = 0, rx = 0, ry = 0
    let rafId

    const onMove = e => {
      mx = e.clientX; my = e.clientY
      cursor.style.left = mx + 'px'
      cursor.style.top = my + 'px'
    }

    const animRing = () => {
      rx += (mx - rx) * 0.1
      ry += (my - ry) * 0.1
      ring.style.left = rx + 'px'
      ring.style.top = ry + 'px'
      rafId = requestAnimationFrame(animRing)
    }
    rafId = requestAnimationFrame(animRing)

    document.addEventListener('mousemove', onMove)

    const grow = () => cursor.classList.add('grow')
    const shrink = () => cursor.classList.remove('grow')
    const targets = document.querySelectorAll('a, button, .master-card, .dojo-card, .event-row')
    targets.forEach(el => {
      el.addEventListener('mouseenter', grow)
      el.addEventListener('mouseleave', shrink)
    })

    return () => {
      document.removeEventListener('mousemove', onMove)
      cancelAnimationFrame(rafId)
      targets.forEach(el => {
        el.removeEventListener('mouseenter', grow)
        el.removeEventListener('mouseleave', shrink)
      })
    }
  }, [touch])

  if (touch) return null

  return (
    <>
      <div id="cursor"></div>
      <div id="cursor-ring"></div>
    </>
  )
}
