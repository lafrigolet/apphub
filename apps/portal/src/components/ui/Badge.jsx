export default function Badge({ variant = 'gray', children, className = '' }) {
  return (
    <span className={`badge badge-${variant} ${className}`}>
      {children}
    </span>
  )
}
