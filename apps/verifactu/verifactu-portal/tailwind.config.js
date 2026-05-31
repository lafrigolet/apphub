/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,jsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ['Sora', 'sans-serif'],
        sans: ['"IBM Plex Sans"', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'monospace'],
      },
      colors: {
        azul: {
          50: '#eef4ff', 100: '#d9e6ff', 200: '#b3ccff', 300: '#84a9ff',
          400: '#4f7dff', 500: '#2563eb', 600: '#1d4ed8', 700: '#1e40af',
          800: '#1e3a8a', 900: '#172554',
        },
        tinta: '#0b1220',
      },
    },
  },
}
