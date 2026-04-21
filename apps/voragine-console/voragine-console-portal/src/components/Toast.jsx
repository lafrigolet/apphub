import { useApp } from '../context/AppContext'
import { icons } from '../lib/icons'

export default function ToastContainer() {
  const { toasts } = useApp()
  return (
    <div className="fixed bottom-6 right-6 z-[200] flex flex-col gap-2 items-end pointer-events-none">
      {toasts.map(t => <ToastItem key={t.id} {...t} />)}
    </div>
  )
}

function ToastItem({ msg, variant }) {
  const border = variant === 'ok' ? 'border-ok' : variant === 'warn' ? 'border-warn' : variant === 'danger' ? 'border-danger' : 'border-ink'
  const text   = variant === 'ok' ? 'text-ok'   : variant === 'warn' ? 'text-warn'   : variant === 'danger' ? 'text-danger'   : 'text-ink'
  return (
    <div className={`bg-white border ${border} rounded-lg shadow-pop px-4 py-3 text-sm fade-up flex items-start gap-3 max-w-sm`}>
      <span className={`mt-0.5 ${text}`}>{icons.check}</span>
      <span>{msg}</span>
    </div>
  )
}
