// Segmented Test | Live switch for the Stripe config views. Shows which mode
// is ACTIVE (persisted in the module's `stripe_mode` config row) and lets the
// operator select the other one — the change only takes effect when the view's
// "Guardar" button PATCHes `stripe_mode` (explicit confirmation, same
// save-only-what-you-touched pattern as the rest of the form).
export default function StripeModeSwitch({ mode, loadedMode, onChange }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-[12px] uppercase tracking-[0.14em] text-ink3">Modo</span>
      <div className="inline-flex rounded-md border border-line overflow-hidden" role="group" aria-label="Modo Stripe">
        {['test', 'live'].map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => onChange?.(m)}
            aria-pressed={mode === m}
            className={`px-4 py-1.5 text-[13px] transition-colors ${
              mode === m ? 'bg-ink text-paper' : 'bg-paper2 text-ink2 hover:text-ink'
            }`}
          >
            {m === 'test' ? 'Test' : 'Live'}
            {loadedMode === m && (
              <span className="ml-2 text-[10px] uppercase tracking-wider opacity-70">activo</span>
            )}
          </button>
        ))}
      </div>
      {mode !== loadedMode && (
        <span className="text-[12px] text-ink3">se aplicará al guardar</span>
      )}
    </div>
  )
}
