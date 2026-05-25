/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,jsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Space Grotesk"', 'sans-serif'],
        serif:   ['"Instrument Serif"', 'serif'],
        sans:    ['"Outfit"', 'sans-serif'],
        mono:    ['"JetBrains Mono"', 'monospace'],
      },
      colors: {
        ink: {
          900: '#050B1A',
          800: '#0A1228',
          700: '#0F1B3D',
          600: '#1A2A5C',
        },
        electric: {
          50:  '#EBF2FF',
          100: '#D6E4FF',
          200: '#ADC8FF',
          300: '#7AA5FF',
          400: '#3D7DFF',
          500: '#0066FF',
          600: '#0052D9',
          700: '#0040B3',
          800: '#002F8C',
          900: '#001F66',
        },
        spark: {
          400: '#FBBF24',
          500: '#F59E0B',
          600: '#D97706',
        },
        bone: '#F7F9FC',
      },
      boxShadow: {
        'soft':     '0 1px 2px rgba(5,11,26,0.04), 0 8px 24px rgba(5,11,26,0.06)',
        'lift':     '0 1px 2px rgba(5,11,26,0.06), 0 20px 40px -12px rgba(0,82,217,0.22)',
        'glow':     '0 0 0 1px rgba(0,102,255,0.2), 0 12px 40px -8px rgba(0,102,255,0.45)',
        'electric': '0 8px 30px -6px rgba(0,102,255,0.4)',
      },
    },
  },
}
