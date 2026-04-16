/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['DM Sans', 'sans-serif'],
        mono: ['DM Mono', 'monospace'],
      },
      colors: {
        stripe: '#635BFF',
        'stripe-dark': '#4F46E5',
        'stripe-light': '#EEF0FF',
        ink: '#0A0A0F',
        'ink-2': '#1C1C2A',
        mist: '#F4F4F8',
        'mist-2': '#EAEAF2',
        sage: '#00C896',
        'sage-dark': '#00A07A',
        ember: '#FF6B35',
        'ember-light': '#FFF0EB',
        slate: '#6B7280',
        'slate-light': '#F9FAFB',
      },
    },
  },
  plugins: [],
}
