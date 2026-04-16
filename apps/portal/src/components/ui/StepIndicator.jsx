/**
 * steps   : string[] — step labels
 * current : number   — 1-based current step index
 */
export default function StepIndicator({ steps, current }) {
  return (
    <div className="flex items-center gap-0 mb-8">
      {steps.map((label, i) => {
        const n        = i + 1
        const isDone   = n < current
        const isActive = n === current
        const isLast   = i === steps.length - 1

        return (
          <div key={n} className={`flex items-center ${!isLast ? 'flex-1' : ''}`}>
            <div className="flex flex-col items-center gap-1">
              <div className={`step-dot ${isDone ? 'done' : isActive ? 'active' : 'pending'}`}>
                {isDone ? '✓' : n}
              </div>
              <span className={`text-[10px] whitespace-nowrap ${isActive ? 'text-stripe font-medium' : 'text-slate'}`}>
                {label}
              </span>
            </div>
            {!isLast && (
              <div className={`flex-1 h-px ${isDone ? 'bg-sage' : 'bg-mist-2'} mb-3 mx-2`} />
            )}
          </div>
        )
      })}
    </div>
  )
}
