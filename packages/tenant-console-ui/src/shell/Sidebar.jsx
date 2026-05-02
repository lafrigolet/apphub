import { useApp } from './lib/context'
import { CATEGORIES, categoryLabel } from './lib/categories'
import { icons } from './lib/icons'

export default function Sidebar() {
  const { manifests, view, navigate } = useApp()

  // Bucket sidebar entries by category, preserving the order CATEGORIES
  // declares. An entry without a category falls into 'configuration' so
  // every manifest is reachable even if it forgot to set one.
  const buckets = new Map(CATEGORIES.map((c) => [c.id, []]))
  for (const m of manifests) {
    for (const e of m.sidebar ?? []) {
      const cat = buckets.has(e.category) ? e.category : 'configuration'
      buckets.get(cat).push({ ...e, moduleId: m.id })
    }
  }

  return (
    <aside className="w-60 shrink-0 border-r border-line min-h-[calc(100vh-56px)] bg-paper sticky top-14 self-start h-[calc(100vh-56px)] overflow-y-auto">
      <nav className="p-3">
        {/* Inicio is always visible. */}
        <button
          onClick={() => navigate('home')}
          className={`w-full text-left flex items-center gap-3 px-4 py-2 rounded-lg text-[13.5px] mt-2 ${view === 'home' ? 'bg-paper2 text-ink' : 'text-ink2 hover:bg-paper2'}`}
        >
          <span className="text-ink3">{icons.dashboard}</span>
          <span>Inicio</span>
        </button>

        {CATEGORIES.filter((c) => c.id !== 'home').map((cat) => {
          const entries = buckets.get(cat.id) ?? []
          if (entries.length === 0) return null
          return (
            <div key={cat.id}>
              <div className="px-4 pt-5 pb-2 text-[10px] uppercase tracking-[0.18em] text-ink3 border-t border-line mt-3">
                {categoryLabel(cat.id)}
              </div>
              {entries.map((e) => (
                <button
                  key={e.view}
                  onClick={() => navigate(e.view)}
                  className={`w-full text-left flex items-center gap-3 px-4 py-2 rounded-lg text-[13.5px] ${view === e.view ? 'bg-paper2 text-ink' : 'text-ink2 hover:bg-paper2'}`}
                >
                  <span className={view === e.view ? 'text-ink' : 'text-ink3'}>{e.icon ?? icons.settings}</span>
                  <span>{e.label}</span>
                </button>
              ))}
            </div>
          )
        })}
      </nav>
    </aside>
  )
}
