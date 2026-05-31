import { useState, useCallback } from 'react'

// Sidebar section switching — the React equivalent of the prototypes'
// `go(id, el)` that toggled [data-section] visibility. Returns the active
// section id, a setter, and a helper that also scrolls to top (matching the
// prototype's window.scrollTo on navigation).
export function useSection(initial) {
  const [active, setActive] = useState(initial)
  const go = useCallback((id) => {
    setActive(id)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])
  return [active, go]
}
