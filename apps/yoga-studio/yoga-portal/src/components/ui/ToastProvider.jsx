import { createContext, useContext, useState, useCallback } from 'react'
import { cn } from '../../lib/utils.js'

const ToastCtx = createContext(null)

export function useToast() {
  return useContext(ToastCtx)
}

let _id = 0

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const toast = useCallback((message, type = 'success') => {
    const id = ++_id
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000)
  }, [])

  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2 max-w-sm w-full">
        {toasts.map(t => (
          <div key={t.id} className={cn(
            'rounded-xl px-4 py-3 shadow-lg text-sm font-medium flex items-center gap-2 modal-enter',
            t.type === 'success' && 'bg-sage-600 text-white',
            t.type === 'error' && 'bg-red-600 text-white',
            t.type === 'info' && 'bg-blue-600 text-white',
          )}>
            {t.type === 'success' && '✓'}
            {t.type === 'error' && '✕'}
            {t.type === 'info' && 'ℹ'}
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}
