export default function Card({ flat = false, className = '', children }) {
  return (
    <div className={`${flat ? 'card-flat' : 'card'} ${className}`}>
      {children}
    </div>
  )
}
