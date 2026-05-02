import { useEffect, useState } from 'react'
import { useApp } from './lib/context'
import { CATEGORIES, categoryLabel } from './lib/categories'
import { api } from './lib/api'

// Dashboard composition layer.
//
// Each manifest contributes 0..N dashboardCards: { id, category, label,
// summary?, primaryAction? }. We invoke summary(api) in parallel via
// Promise.allSettled so a card that throws stays in 'error' state without
// taking down the rest. Cards are bucketed by category and rendered in
// the same order categories appear in the sidebar.

function CardShell({ label, status, metric, error, onClick, primaryActionLabel }) {
  const tone = error ? 'border-danger/30 bg-dangerbg/40'
             : status === 'unconfigured' ? 'border-warn/30 bg-warnbg/40'
             : 'border-line bg-white'
  return (
    <div className={`border ${tone} rounded-xl shadow-card p-4 flex flex-col justify-between min-h-[110px]`}>
      <div>
        <div className="text-[11px] uppercase tracking-[0.14em] text-ink3 mb-1">{label}</div>
        {error ? (
          <div className="text-[13px] text-danger">Error: {error}</div>
        ) : (
          <div className="font-display text-[20px] leading-tight">{metric ?? <span className="text-ink3 italic">—</span>}</div>
        )}
      </div>
      {onClick && (
        <div className="flex justify-end mt-3">
          <button onClick={onClick} className="text-[12px] text-ink2 hover:text-ink underline">
            {primaryActionLabel ?? 'Configurar'} →
          </button>
        </div>
      )}
    </div>
  )
}

export default function DashboardGrid() {
  const { manifests, navigate, tenant } = useApp()
  const [cardStates, setCardStates] = useState({})

  // Collect cards from every manifest, then resolve their summaries.
  const cards = manifests.flatMap((m) => (m.dashboardCards ?? []).map((c) => ({ ...c, moduleId: m.id })))

  useEffect(() => {
    let cancelled = false
    setCardStates({})
    Promise.allSettled(
      cards.map(async (c) => {
        if (typeof c.summary !== 'function') return [c.id, { metric: null, status: 'active' }]
        const r = await c.summary(api)
        return [c.id, r ?? {}]
      }),
    ).then((results) => {
      if (cancelled) return
      const next = {}
      for (let i = 0; i < results.length; i++) {
        const r = results[i]
        const id = cards[i].id
        next[id] = r.status === 'fulfilled' ? r.value[1] : { error: r.reason?.message ?? 'failed' }
      }
      setCardStates(next)
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifests.length])

  const buckets = new Map(CATEGORIES.map((c) => [c.id, []]))
  for (const c of cards) {
    const cat = buckets.has(c.category) ? c.category : 'configuration'
    buckets.get(cat).push(c)
  }

  return (
    <div className="p-8 max-w-6xl fade-up">
      <div className="mb-8">
        <div className="text-[12px] uppercase tracking-[0.18em] text-ink3 mb-2">Inicio</div>
        <h1 className="font-display text-[44px] leading-none tracking-tight">
          <span className="italic font-normal">{tenant?.display_name ?? 'Bienvenido'}</span>
        </h1>
        <p className="text-ink3 mt-3 max-w-2xl">
          Resumen del estado por capability. Cada card resume lo configurado y
          enlaza a la vista profunda de su módulo.
        </p>
      </div>

      {CATEGORIES.filter((c) => c.id !== 'home').map((cat) => {
        const entries = buckets.get(cat.id) ?? []
        if (entries.length === 0) return null
        return (
          <section key={cat.id} className="mb-8">
            <div className="text-[11px] uppercase tracking-[0.18em] text-ink3 mb-3">{categoryLabel(cat.id)}</div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {entries.map((c) => {
                const state = cardStates[c.id] ?? {}
                return (
                  <CardShell
                    key={c.id}
                    label={c.label}
                    metric={state.metric}
                    status={state.status}
                    error={state.error}
                    onClick={c.primaryAction ? () => navigate(c.primaryAction.view) : null}
                    primaryActionLabel={c.primaryAction?.label}
                  />
                )
              })}
            </div>
          </section>
        )
      })}

      {cards.length === 0 && (
        <div className="border border-line bg-paper2 rounded-xl p-10 text-center text-ink3 text-[13px]">
          No hay módulos habilitados para esta app. Contacta con el equipo de plataforma para activarlos.
        </div>
      )}
    </div>
  )
}
