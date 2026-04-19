export function cn(...classes) {
  return classes.filter(Boolean).join(' ')
}

export function formatDate(dateStr) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })
}

export function formatTime(timeStr) {
  if (!timeStr) return '—'
  return timeStr.slice(0, 5)
}

export function todayLabel() {
  return new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })
}

export function getInitials(name = '') {
  return name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2)
}

export const LEVEL_LABELS = {
  todos: 'Todos',
  principiante: 'Principiante',
  intermedio: 'Intermedio',
  avanzado: 'Avanzado',
}

export const LEVEL_COLORS = {
  todos:        'bg-sage-100 text-sage-700',
  principiante: 'bg-warm-100 text-warm-700',
  intermedio:   'bg-blue-100 text-blue-700',
  avanzado:     'bg-red-100 text-red-700',
}

export const TYPE_LABELS = {
  hatha:        'Hatha Flow',
  vinyasa:      'Vinyasa',
  yin:          'Yin Yoga',
  restaurativo: 'Restaurativo',
  power:        'Power Yoga',
  mindfulness:  'Meditación',
}

export const STATUS_COLORS = {
  confirmed: 'bg-sage-100 text-sage-700',
  cancelled: 'bg-red-100 text-red-700',
  attended:  'bg-blue-100 text-blue-700',
  no_show:   'bg-warm-100 text-warm-700',
  waiting:   'bg-sand-100 text-sand-600',
}

export const STATUS_LABELS = {
  confirmed: 'Confirmada',
  cancelled: 'Cancelada',
  attended:  'Asistida',
  no_show:   'No presentado',
  waiting:   'En espera',
}
