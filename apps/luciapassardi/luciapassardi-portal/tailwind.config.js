/** Estética "sereno / zen" — piedra/salvia/teal, serif Cormorant + texto Mulish. */
export default {
  content: [
    './index.html',
    './src/**/*.{js,jsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Cormorant Garamond"', 'Cormorant', 'serif'],
        sans: ['Mulish', 'system-ui', 'sans-serif'],
      },
      colors: {
        piedra: '#ECEAE3',   // fondo principal
        crema: '#F6F4EF',    // fondo claro / tarjetas
        niebla: '#DDE3DD',   // gris-verde tenue
        salvia: {
          400: '#9CAE94',
          500: '#8A9A7B',
          600: '#6E7E64',
        },
        teal: {
          500: '#6E8E8A',
          600: '#587571',   // acento
          700: '#46615D',
        },
        tinta: '#2B2A26',    // texto
      },
      boxShadow: {
        soft: '0 1px 2px rgba(43,42,38,0.03), 0 16px 40px -24px rgba(43,42,38,0.18)',
        lift: '0 1px 2px rgba(43,42,38,0.05), 0 30px 60px -30px rgba(88,117,113,0.28)',
      },
      letterSpacing: {
        widest2: '0.28em',
      },
    },
  },
  plugins: [],
}
