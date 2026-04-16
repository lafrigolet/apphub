import { useToast } from '../ui/ToastProvider'

export default function SandboxBanner() {
  const toast = useToast()
  return (
    <div className="sandbox-banner px-4 py-2 flex items-center justify-between text-xs">
      <div className="flex items-center gap-2">
        <span className="inline-block w-2 h-2 rounded-full bg-amber-400" />
        <span className="font-medium text-amber-700">MODO SANDBOX</span>
        <span className="text-amber-600">— Los datos son de prueba. No se procesarán pagos reales.</span>
      </div>
      <button
        onClick={() => toast.show('Cambiando a producción...', 'info')}
        className="text-amber-700 font-medium hover:underline"
      >
        Activar Producción →
      </button>
    </div>
  )
}
