// Tailwind preset shared by every consumer of @apphub/tenant-console-ui.
//
// Consumers extend their own tailwind.config.js with this preset so the
// design tokens (colors, fonts, shadows) used by the package's classNames
// resolve. Each consumer is still responsible for its own `content` glob,
// which MUST include the package source so Tailwind's JIT scans it:
//
//   content: [
//     './index.html',
//     './src/**/*.{js,jsx}',
//     '../../../packages/tenant-console-ui/src/**/*.{js,jsx}',
//   ]

module.exports = {
  theme: {
    extend: {
      fontFamily: {
        display: ['"Fraunces"', 'serif'],
        sans:    ['"Instrument Sans"', 'system-ui', 'sans-serif'],
        mono:    ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        paper:    '#FAF7F2',
        paper2:   '#F3EFE7',
        ink:      '#14131A',
        ink2:     '#3B3A42',
        ink3:     '#6F6D78',
        line:     '#E5DFD2',
        line2:    '#D9D2C2',
        accent:   '#D9512C',
        accent2:  '#A83E1F',
        ok:       '#2F6F4F',
        okbg:     '#E4EFE8',
        warn:     '#8A6B0A',
        warnbg:   '#F6EFD6',
        danger:   '#8A2C2C',
        dangerbg: '#F1E0DE',
        info:     '#2C5280',
        infobg:   '#E2EAF2',
      },
      boxShadow: {
        card: '0 1px 0 rgba(20,19,26,0.02), 0 2px 6px rgba(20,19,26,0.04)',
        pop:  '0 8px 24px rgba(20,19,26,0.10), 0 2px 6px rgba(20,19,26,0.05)',
      },
    },
  },
  plugins: [],
}
