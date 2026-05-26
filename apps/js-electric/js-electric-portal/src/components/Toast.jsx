export default function Toast({ msg, show, ok = true }) {
  return (
    <div className={`toast ${show ? 'show' : ''} fixed bottom-6 left-1/2 -translate-x-1/2 ${ok ? 'bg-ink-900' : 'bg-red-700'} text-white px-5 py-3 rounded-full shadow-lift z-50 text-sm flex items-center gap-2`}>
      <svg className="w-4 h-4 text-spark-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
      <span>{msg || '¡Solicitud enviada! Te llamaremos pronto.'}</span>
    </div>
  )
}
