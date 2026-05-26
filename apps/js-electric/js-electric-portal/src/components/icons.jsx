// Iconos SVG inline reutilizados en varias secciones. Mantener
// strokeWidth configurable; el resto sigue el diseño del prototipo.

export const Arrow = ({ className = 'w-4 h-4' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M13 5l7 7-7 7" />
  </svg>
)

export const Star = ({ className = 'w-6 h-6' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2l2.39 7.36H22l-6.2 4.5L18.18 22 12 17.5 5.82 22l2.38-8.14L2 9.36h7.61z" />
  </svg>
)

export const Phone = ({ className = 'w-4 h-4 ico' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 5.5C3 4.12 4.12 3 5.5 3h2.13a2 2 0 011.94 1.5l.7 2.8a2 2 0 01-.5 1.9L8.4 10.6a14 14 0 005 5l1.4-1.37a2 2 0 011.9-.5l2.8.7A2 2 0 0121 16.37V18.5c0 1.38-1.12 2.5-2.5 2.5C10.4 21 3 13.6 3 5.5z" />
  </svg>
)

export const Check = ({ className = 'w-5 h-5' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
  </svg>
)

// Genérico — recibe un path string desde data/mock.js (services / valores)
// para mantener los datos puros (sin JSX en mock.js).
export const SvgIcon = ({ d, className = 'w-7 h-7 ico', strokeWidth = 1.6 }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth}>
    <path strokeLinecap="round" strokeLinejoin="round" d={d} />
  </svg>
)
