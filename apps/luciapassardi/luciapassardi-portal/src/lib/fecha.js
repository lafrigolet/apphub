const MESES = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC']

// 'YYYY-MM-DD' → { dia: '12', mes: 'JUL', anio: 2026 }
export function fmtFecha(iso) {
  const d = new Date(`${iso}T00:00:00`)
  return {
    dia: String(d.getDate()).padStart(2, '0'),
    mes: MESES[d.getMonth()],
    anio: d.getFullYear(),
  }
}
