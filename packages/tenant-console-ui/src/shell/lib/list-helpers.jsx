// Shared building blocks for Fase 3 module views. Keep this small — only
// the UI bits that 3+ list-style views actually share. Anything used by a
// single view stays inline in that view.
import { useEffect, useState } from 'react'

// useFetch — boilerplate for "GET something on mount, expose loading +
// error + refetch". Returns [data, { loading, error, refetch }]. The view
// owns rendering and any status-specific UI.
export function useFetch(loader, deps = []) {
  const [data, setData]         = useState(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)
  const [tick, setTick]         = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    loader()
      .then((d) => { if (!cancelled) setData(d) })
      .catch((e) => { if (!cancelled) setError(e.message ?? String(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])

  return [data, { loading, error, refetch: () => setTick((t) => t + 1) }]
}

// PageHeader — display style shared across module views.
export function PageHeader({ title, subtitle, kicker, actions }) {
  return (
    <div className="flex items-start justify-between gap-6 mb-8">
      <div>
        {kicker && <div className="text-[12px] uppercase tracking-[0.18em] text-ink3 mb-2">{kicker}</div>}
        <h1 className="font-display text-[44px] leading-none tracking-tight">
          <span className="italic font-normal">{title}</span>
        </h1>
        {subtitle && <p className="text-ink3 mt-3 max-w-2xl">{subtitle}</p>}
      </div>
      {actions && <div className="shrink-0 flex items-center gap-2">{actions}</div>}
    </div>
  )
}

// Card wrapper for single-section views.
export function Panel({ title, hint, children, footer }) {
  return (
    <div className="bg-white border border-line rounded-xl shadow-card">
      {(title || hint) && (
        <div className="px-5 py-4 border-b border-line">
          {title && <div className="font-display text-[18px]">{title}</div>}
          {hint && <div className="text-xs text-ink3 mt-0.5">{hint}</div>}
        </div>
      )}
      <div className="p-5">{children}</div>
      {footer && <div className="px-5 py-3 border-t border-line text-[12px] text-ink3">{footer}</div>}
    </div>
  )
}

// EmptyState — what to show when the list is empty (or filtered to zero).
export function Empty({ title = 'Sin resultados', hint }) {
  return (
    <div className="border border-line bg-paper2 rounded-xl p-10 text-center">
      <div className="text-[14px] text-ink2">{title}</div>
      {hint && <div className="text-[12px] text-ink3 mt-1">{hint}</div>}
    </div>
  )
}

// Generic table with column descriptors. cols = [{ key, label, render? }].
export function Table({ cols, rows, onRowClick, empty }) {
  if (!rows?.length) return <Empty {...(empty ?? {})} />
  return (
    <div className="bg-white border border-line rounded-xl shadow-card overflow-hidden">
      <table className="w-full text-[13.5px]">
        <thead className="bg-paper2 text-[11px] uppercase tracking-[0.14em] text-ink3">
          <tr>{cols.map((c) => <th key={c.key} className="text-left px-4 py-2 font-normal">{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={r.id ?? i}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              className={`border-t border-line ${onRowClick ? 'hover:bg-paper2 cursor-pointer' : ''}`}
            >
              {cols.map((c) => <td key={c.key} className="px-4 py-2.5">{c.render ? c.render(r) : (r[c.key] ?? '—')}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
