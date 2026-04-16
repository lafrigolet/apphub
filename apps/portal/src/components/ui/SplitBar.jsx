/**
 * segments: Array<{ percent: number, color: string }>
 * Renders a horizontal proportional bar (split-preview).
 */
export default function SplitBar({ segments = [] }) {
  const filtered = segments.filter((s) => s.percent > 0)
  return (
    <div className="split-preview">
      {filtered.map((s, i) => (
        <div key={i} style={{ width: `${s.percent}%`, background: s.color }} />
      ))}
    </div>
  )
}
