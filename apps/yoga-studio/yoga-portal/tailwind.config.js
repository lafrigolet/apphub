/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        serif: ['Playfair Display', 'serif'],
        sans: ['DM Sans', 'sans-serif'],
      },
      colors: {
        sage: {
          50:  '#f0f7ec',
          100: '#daefd0',
          200: '#b5dea1',
          300: '#8bcb6e',
          400: '#64b542',
          500: '#4a9a2a',
          600: '#3a7a20',
          700: '#2e5d3b',
          800: '#1e3d28',
          900: '#122418',
        },
        warm: {
          50:  '#fdf9f3',
          100: '#faefd9',
          200: '#f4d99f',
          300: '#edc063',
          400: '#e5a530',
          500: '#c88010',
          600: '#a66508',
          700: '#7a4c06',
        },
        sand: {
          50:  '#faf8f5',
          100: '#f2ede4',
          200: '#e4d9c8',
          300: '#d0bc9c',
          400: '#b89970',
          500: '#9e7a4e',
          600: '#7a5c35',
          700: '#5c4020',
        },
      },
    },
  },
  plugins: [],
}
