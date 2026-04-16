export default function ProgressBar({ fillPercent, color }) {
  return (
    <div className="progress-track">
      <div
        className="progress-fill"
        style={{
          width: `${Math.max(0, Math.min(100, fillPercent))}%`,
          ...(color ? { background: color } : {}),
        }}
      />
    </div>
  )
}
