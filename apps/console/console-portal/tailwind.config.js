/** @type {import('tailwindcss').Config} */
//
// Rebrand 2026-05: console adopts the Hulkstein landing's palette.
// We keep the legacy token names (paper/ink/accent/ok/…) so the 41 existing
// views compile without per-file edits, but the underlying hex values now
// map to indigo + slate + emerald/amber/rose/sky.
//
// For NEW code prefer Tailwind defaults (`indigo-600`, `slate-900`, …) over
// the legacy aliases below — they're kept only for backwards compat.

export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        // Single sans across the app. `display` resolves to Inter too — the
        // legacy `font-display` class becomes a no-op but doesn't need to
        // be stripped from every component.
        sans:    ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono:    ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        // Neutrals — remapped from warm cream/ink to slate.
        paper:    '#FFFFFF',  // main bg (was #FAF7F2)
        paper2:   '#F8FAFC',  // secondary bg (slate-50, was #F3EFE7)
        ink:      '#0F172A',  // primary text (slate-900, was #14131A)
        ink2:     '#334155',  // secondary text (slate-700, was #3B3A42)
        ink3:     '#64748B',  // tertiary text (slate-500, was #6F6D78)
        line:     '#E2E8F0',  // borders (slate-200, was #E5DFD2)
        line2:    '#CBD5E1',  // strong borders (slate-300, was #D9D2C2)

        // Brand accent — terracota → indigo.
        accent:   '#4F46E5',  // indigo-600 (was #D9512C)
        accent2:  '#4338CA',  // indigo-700 hover (was #A83E1F)

        // Semantic states — remapped to Tailwind's emerald/amber/red/blue.
        ok:       '#059669',  // emerald-600
        okbg:     '#ECFDF5',  // emerald-50
        warn:     '#D97706',  // amber-600
        warnbg:   '#FEF3C7',  // amber-100
        danger:   '#DC2626',  // red-600
        dangerbg: '#FEE2E2',  // red-100
        info:     '#2563EB',  // blue-600
        infobg:   '#DBEAFE',  // blue-100
      },
      boxShadow: {
        card: '0 1px 0 rgba(15,23,42,0.02), 0 2px 6px rgba(15,23,42,0.04)',
        pop:  '0 8px 24px rgba(15,23,42,0.10), 0 2px 6px rgba(15,23,42,0.05)',
      },
    },
  },
  plugins: [],
}
