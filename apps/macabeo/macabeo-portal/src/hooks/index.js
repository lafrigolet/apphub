import { useState, useEffect, useCallback, useRef } from 'react'

// Generic countdown — returns { h, m, s } zero-padded strings.
// Used e.g. by the socio dashboard "cierre del pedido" timer.
export function useCountdown(initialSeconds) {
  const [sec, setSec] = useState(initialSeconds)
  useEffect(() => {
    const id = setInterval(() => setSec((s) => (s > 0 ? s - 1 : 0)), 1000)
    return () => clearInterval(id)
  }, [])
  const pad = (n) => String(n).padStart(2, '0')
  return {
    h: pad(Math.floor(sec / 3600)),
    m: pad(Math.floor((sec % 3600) / 60)),
    s: pad(sec % 60),
  }
}

// Generic transient toast — returns [visible, show].
export function useToast(duration = 1800) {
  const [visible, setVisible] = useState(false)
  const timer = useRef(null)
  const show = useCallback(() => {
    setVisible(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setVisible(false), duration)
  }, [duration])
  useEffect(() => () => clearTimeout(timer.current), [])
  return [visible, show]
}
