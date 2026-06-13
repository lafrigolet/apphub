// Iconos SVG (stroke) reutilizables. Trazo fino, coherente con la estética zen.
function Stroke({ children, className = 'w-5 h-5' }) {
  return (
    <svg className={`ico ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}

export const Leaf = (p) => (
  <Stroke {...p}><path d="M11 20A7 7 0 0 1 4 13c0-5 4-9 16-9 0 9-4 13-9 14Z" /><path d="M11 20c0-4 2-7 6-9" /></Stroke>
)
export const Arrow = (p) => (
  <Stroke {...p}><path d="M5 12h14" /><path d="M13 6l6 6-6 6" /></Stroke>
)
export const Menu = (p) => (
  <Stroke {...p}><path d="M4 7h16" /><path d="M4 12h16" /><path d="M4 17h16" /></Stroke>
)
export const Close = (p) => (
  <Stroke {...p}><path d="M6 6l12 12" /><path d="M18 6 6 18" /></Stroke>
)
export const Check = (p) => (
  <Stroke {...p}><path d="M20 6 9 17l-5-5" /></Stroke>
)
export const Mail = (p) => (
  <Stroke {...p}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></Stroke>
)
export const Whatsapp = (p) => (
  <Stroke {...p}><path d="M21 11.5a8.5 8.5 0 0 1-12.6 7.4L3 21l2.2-5.3A8.5 8.5 0 1 1 21 11.5Z" /><path d="M8.5 9.5c0 4 2 6 5.5 6.5l1-1.8-2.3-1-1 1c-1-.6-1.8-1.4-2.4-2.4l1-1-1-2.3-1.8.9Z" /></Stroke>
)
export const Instagram = (p) => (
  <Stroke {...p}><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="3.5" /><circle cx="17.5" cy="6.5" r="0.6" fill="currentColor" /></Stroke>
)
export const Youtube = (p) => (
  <Stroke {...p}><rect x="3" y="6" width="18" height="12" rx="3" /><path d="m11 9 4 3-4 3V9Z" fill="currentColor" stroke="none" /></Stroke>
)
export const Sun = (p) => (
  <Stroke {...p}><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" /></Stroke>
)
export const Bag = (p) => (
  <Stroke {...p}><path d="M6 8h12l-1 12H7L6 8Z" /><path d="M9 8a3 3 0 0 1 6 0" /></Stroke>
)
