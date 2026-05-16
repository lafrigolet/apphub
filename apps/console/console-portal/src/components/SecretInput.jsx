import { useState } from 'react'

// Reusable input for secrets that the API never returns in plaintext.
// Behavior:
//   - If `configured` is true (API said the row exists), show a "Configurado"
//     pill and a "Cambiar" button. The user must click "Cambiar" before the
//     field becomes editable — prevents accidental overwrites.
//   - If `configured` is false, the input is editable from the start.
// Always emits `null` when cleared (sentinel for "leave unchanged" if the
// caller checks `!== null`, or "explicit clear" depending on form intent).
export default function SecretInput({ label, configured, value, onChange, placeholder }) {
  const [unlocked, setUnlocked] = useState(!configured)

  return (
    <div>
      <label className="block text-[12px] uppercase tracking-[0.14em] text-ink3 mb-1">{label}</label>
      <div className="flex items-center gap-2">
        {!unlocked ? (
          <>
            <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-line bg-paper2 text-[13px] text-ink2">
              <span className="font-mono">••••••••</span>
              <span className="text-[11px] text-ink3 uppercase tracking-wider">Configurado</span>
            </span>
            <button
              type="button"
              onClick={() => { setUnlocked(true); onChange?.('') }}
              className="btn btn-ghost text-[12px]"
            >
              Cambiar
            </button>
          </>
        ) : (
          <input
            type="password"
            autoComplete="new-password"
            value={value ?? ''}
            placeholder={placeholder}
            onChange={(e) => onChange?.(e.target.value)}
            className="input flex-1 font-mono text-[13px]"
          />
        )}
      </div>
    </div>
  )
}
