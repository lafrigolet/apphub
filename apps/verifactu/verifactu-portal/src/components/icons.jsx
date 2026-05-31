// Reusable inline SVGs + brand chrome shared across the role views.

// Azul rounded box with the VERI·FACTU check glyph (every header/sidebar).
export const LogoMark = ({ className = 'h-8 w-8' }) => (
  <div className={`${className} rounded-lg bg-azul-500 grid place-items-center`}>
    <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
      <path d="M5 12l4 4L19 6" />
    </svg>
  </div>
)

// VERI·FACTU wordmark with the azul middle dot.
export const Wordmark = ({ className = 'font-display font-700 tracking-tight' }) => (
  <span className={className}>VERI<span className="text-azul-500">·</span>FACTU</span>
)

export const IconArrowRight = ({ className = 'arrow w-4 h-4' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
)

export const IconBack = ({ className = 'w-4 h-4' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M19 12H5M11 18l-6-6 6-6" />
  </svg>
)

export const IconPlus = ({ className = 'w-4 h-4' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
    <path d="M12 5v14M5 12h14" />
  </svg>
)
