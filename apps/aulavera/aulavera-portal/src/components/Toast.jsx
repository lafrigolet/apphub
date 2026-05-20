import { createContext, useCallback, useContext, useState } from 'react'

const ToastContext = createContext(() => {})

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null)

  const showToast = useCallback((msg) => {
    setToast(msg)
    setTimeout(() => setToast((t) => (t === msg ? null : t)), 3200)
  }, [])

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      {toast && <div className="toast">{toast}</div>}
    </ToastContext.Provider>
  )
}

export function useToast() {
  return useContext(ToastContext)
}
