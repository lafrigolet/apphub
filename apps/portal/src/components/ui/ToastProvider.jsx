import { createContext, useCallback, useContext, useRef, useState } from 'react'
import ReactDOM from 'react-dom'

const ToastContext = createContext(null)

export function useToast() {
  return useContext(ToastContext)
}

const ICONS  = { success: '✓', error: '✕', info: 'ℹ', warning: '⚠' }
const COLORS = { success: 'bg-ink', error: 'bg-red-700', info: 'bg-stripe', warning: 'bg-amber-600' }

export function ToastProvider({ children }) {
  const [toast, setToast]  = useState(null)
  const timerRef           = useRef(null)

  const show = useCallback((message, type = 'success') => {
    clearTimeout(timerRef.current)
    setToast({ message, type, key: Date.now() })
    timerRef.current = setTimeout(() => setToast(null), 3000)
  }, [])

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {toast &&
        ReactDOM.createPortal(
          <div className="toast" key={toast.key}>
            <div className={`flex items-center gap-3 ${COLORS[toast.type] ?? 'bg-ink'} text-white px-4 py-3 rounded-xl shadow-xl text-sm font-medium`}>
              <span>{ICONS[toast.type] ?? '✓'}</span>
              <span>{toast.message}</span>
            </div>
          </div>,
          document.body,
        )}
    </ToastContext.Provider>
  )
}
