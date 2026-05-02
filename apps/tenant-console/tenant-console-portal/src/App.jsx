// Bootstrap landing for the tenant-console.
// Fase 0 of the tenant-console roadmap (TODO.md). The Shell + manifest loader
// arrive in Fase 1; for now this is a one-screen welcome that proves the
// container is wired through NGINX and reachable on
// http://tenant-console.apphub.local:8080.

export default function App() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-paper">
      <div className="max-w-xl text-center px-6">
        <div className="text-[12px] uppercase tracking-[0.18em] text-ink3 mb-3">
          AppHub · Tenant Console
        </div>
        <h1 className="font-display text-[44px] leading-tight tracking-tight">
          <span className="italic font-normal">Bienvenido</span>
        </h1>
        <p className="text-ink3 mt-4">
          Esta consola se monta dinámicamente con los módulos habilitados de tu app.
          El shell genérico llega en la Fase 1; mientras tanto este placeholder
          confirma que el portal está desplegado.
        </p>
      </div>
    </main>
  )
}
