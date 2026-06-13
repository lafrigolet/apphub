// Todo el contenido de la landing (copy + datos). Extraído de luciapassardiyoga.com
// y reorganizado. TODO: sustituir las imágenes placeholder por fotos reales de Lucía.

export const contacto = {
  nombre: 'Lucía Passardi',
  telefono: '+34 622 57 41 91',
  telefonoLink: 'https://wa.me/34622574191',
  whatsappMsg: 'https://wa.me/34622574191?text=Hola%20Luc%C3%ADa,%20me%20gustar%C3%ADa%20informaci%C3%B3n%20sobre%20tus%20clases%20de%20yoga',
  email: 'lucyapassardi@gmail.com',
  emailLink: 'mailto:lucyapassardi@gmail.com',
  instagram: '@luciapassardi',
  instagramLink: 'https://instagram.com/luciapassardi',
  youtubeLink: 'https://youtube.com/@luciapassardi',
  zona: 'Las Matas, Madrid',
}

export const navLinks = [
  { href: '#clases', label: 'Clases' },
  { href: '#horario', label: 'Horario' },
  { href: '#retiros', label: 'Retiros y talleres' },
  { href: '#enfoque', label: 'Mi enfoque' },
  { href: '#sobre-mi', label: 'Conóceme' },
  { href: '#tienda', label: 'Tienda' },
  { href: '#contacto', label: 'Contacto' },
]

export const hero = {
  kicker: 'Yoga y movimiento · ' + contacto.zona,
  titleLead: 'Encuentra tu',
  titleEm: 'equilibrio',
  titleTail: 'sobre la esterilla y fuera de ella.',
  lema: 'Respira… y avanza.',
  intro:
    'Clases íntimas y trato personalizado. El yoga no sólo como ejercicio físico, ' +
    'sino como un método para la autorregulación y para volver a ti.',
}

// Próximos eventos mostrados en el hero (mismo patrón que aikikan). Aikikan los
// trae por API (/api/services/sessions/upcoming); aquí la landing no tiene
// backend, así que son estáticos. TODO: actualizar con fechas reales.
export const proximosEventos = [
  { id: 'ev1', date: '2026-07-12', name: 'Yoga al aire libre', location: 'Parque de Las Matas' },
  { id: 'ev2', date: '2026-09-27', name: 'Taller de abdomen y suelo pélvico', location: 'Estudio · Las Matas' },
  { id: 'ev3', date: '2026-10-18', name: 'Retiro de fin de semana', location: 'Sierra de Madrid' },
  { id: 'ev4', date: '2027-01-10', name: 'Retiro de enero', location: 'Plazas limitadas' },
]

// Calendario de clases semanales. Una sola profesora (Lucía); varias ubicaciones.
// TODO: horario FICTICIO de muestra — sustituir por el calendario real.
export const ubicaciones = [
  { id: 'matas',  nombre: 'Estudio Las Matas', dot: 'bg-teal-600',   text: 'text-teal-700',   soft: 'bg-teal-500/10' },
  { id: 'pinar',  nombre: 'Centro El Pinar',   dot: 'bg-salvia-600', text: 'text-salvia-600', soft: 'bg-salvia-400/15' },
  { id: 'online', nombre: 'Online (Zoom)',     dot: 'bg-tinta/55',   text: 'text-tinta/70',   soft: 'bg-tinta/[0.06]' },
]

export const horarioNota =
  'Horario orientativo (ficticio) — se actualizará con el calendario real. ' +
  'Clases privadas a domicilio bajo petición.'

export const horario = [
  { dia: 'Lunes', corto: 'LUN', clases: [
    { hora: '09:30', dur: 75, tipo: 'Hatha',                   nivel: 'Todos',      ubicacion: 'matas' },
    { hora: '18:30', dur: 75, tipo: 'Vinyasa',                 nivel: 'Intermedio', ubicacion: 'matas' },
  ] },
  { dia: 'Martes', corto: 'MAR', clases: [
    { hora: '10:00', dur: 60, tipo: 'Yoga suave',              nivel: 'Todos',      ubicacion: 'pinar' },
    { hora: '19:00', dur: 90, tipo: 'Ashtanga',               nivel: 'Intermedio', ubicacion: 'matas' },
  ] },
  { dia: 'Miércoles', corto: 'MIÉ', clases: [
    { hora: '09:30', dur: 75, tipo: 'Hatha',                   nivel: 'Todos',      ubicacion: 'matas' },
    { hora: '18:00', dur: 60, tipo: 'Yin y restaurativo',      nivel: 'Todos',      ubicacion: 'online' },
  ] },
  { dia: 'Jueves', corto: 'JUE', clases: [
    { hora: '10:00', dur: 75, tipo: 'Vinyasa',                 nivel: 'Intermedio', ubicacion: 'pinar' },
    { hora: '19:00', dur: 60, tipo: 'Pranayama y meditación',  nivel: 'Todos',      ubicacion: 'matas' },
  ] },
  { dia: 'Viernes', corto: 'VIE', clases: [
    { hora: '09:30', dur: 75, tipo: 'Hatha',                   nivel: 'Todos',      ubicacion: 'matas' },
    { hora: '18:30', dur: 90, tipo: 'Práctica colectiva',      nivel: 'Avanzado',   ubicacion: 'matas' },
  ] },
  { dia: 'Sábado', corto: 'SÁB', clases: [
    { hora: '10:00', dur: 90, tipo: 'Vinyasa',                 nivel: 'Todos',      ubicacion: 'matas' },
  ] },
  { dia: 'Domingo', corto: 'DOM', clases: [
    { hora: '10:30', dur: 60, tipo: 'Yoga suave y meditación', nivel: 'Todos',      ubicacion: 'online' },
  ] },
]

// Tienda. Catálogo FICTICIO de muestra — habrá muchos productos, así que la
// sección filtra por categoría y pagina ("cargar más"). TODO: sustituir por el
// catálogo real (y fotos). Sin backend: el "pedido" se hace por WhatsApp.
export const categorias = [
  { id: 'esterillas', nombre: 'Esterillas' },
  { id: 'props',      nombre: 'Props' },
  { id: 'ropa',       nombre: 'Ropa' },
  { id: 'bienestar',  nombre: 'Bienestar' },
  { id: 'bonos',      nombre: 'Bonos' },
]

export const productos = [
  { id: 'p01', nombre: 'Esterilla Sattva (caucho natural)', categoria: 'esterillas', precio: 69, desc: 'Agarre y amortiguación, 4,5 mm.', badge: 'Top ventas' },
  { id: 'p02', nombre: 'Esterilla de viaje plegable',       categoria: 'esterillas', precio: 45, desc: 'Ligera, 1,5 mm, cabe en la mochila.' },
  { id: 'p03', nombre: 'Esterilla algodón tejida',          categoria: 'esterillas', precio: 39, desc: 'Tradicional, ideal para Ashtanga.' },
  { id: 'p04', nombre: 'Par de bloques de corcho',          categoria: 'props',      precio: 22, desc: 'Estables y naturales.' },
  { id: 'p05', nombre: 'Cinturón de algodón',               categoria: 'props',      precio: 12, desc: 'Hebilla metálica, 2,5 m.' },
  { id: 'p06', nombre: 'Bolster de meditación',             categoria: 'props',      precio: 49, desc: 'Relleno firme, funda lavable.' },
  { id: 'p07', nombre: 'Manta de yoga',                     categoria: 'props',      precio: 35, desc: 'Para relajación y soporte.' },
  { id: 'p08', nombre: 'Leggings Respira',                  categoria: 'ropa',       precio: 39, desc: 'Cintura alta, tejido técnico.', badge: 'Nuevo' },
  { id: 'p09', nombre: 'Top sujeción media',               categoria: 'ropa',       precio: 29, desc: 'Suave, sin costuras.' },
  { id: 'p10', nombre: 'Sudadera "Respira y avanza"',       categoria: 'ropa',       precio: 45, desc: 'Algodón orgánico.' },
  { id: 'p11', nombre: 'Incienso natural (pack 3)',         categoria: 'bienestar',  precio: 9,  desc: 'Lavanda, sándalo y palo santo.' },
  { id: 'p12', nombre: 'Aceite esencial de lavanda',        categoria: 'bienestar',  precio: 14, desc: 'Para relajación y descanso.' },
  { id: 'p13', nombre: 'Mala de 108 cuentas',               categoria: 'bienestar',  precio: 25, desc: 'Semillas de rudraksha.' },
  { id: 'p14', nombre: 'Cojín de ojos (lavanda)',           categoria: 'bienestar',  precio: 18, desc: 'Para savasana y meditación.' },
  { id: 'p15', nombre: 'Bono 5 clases',                     categoria: 'bonos',      precio: 60, desc: 'Caduca a los 2 meses.' },
  { id: 'p16', nombre: 'Bono 10 clases',                    categoria: 'bonos',      precio: 110, desc: 'El mejor precio por clase.', badge: 'Ahorra' },
  { id: 'p17', nombre: 'Tarjeta regalo',                    categoria: 'bonos',      precio: 25, desc: 'Regala práctica. Importe a elegir.', desde: true },
]

export const clases = [
  {
    num: '01',
    title: 'Clases grupales',
    desc:
      'En Las Matas, con horarios flexibles y grupos reducidos para cuidar cada postura. ' +
      'Un espacio cálido donde practicar a tu ritmo.',
    bullets: ['Grupos reducidos', 'Horarios flexibles', 'Todos los niveles'],
  },
  {
    num: '02',
    title: 'Clases privadas',
    desc:
      'Sesiones individuales a domicilio: voy a donde estés. La práctica se adapta por ' +
      'completo a tu cuerpo, tus objetivos y tu momento.',
    bullets: ['A domicilio', 'Práctica a medida', 'Atención plena'],
    destacada: true,
  },
  {
    num: '03',
    title: 'Práctica colectiva',
    desc:
      'Actividad gratuita para alumnas: secuencias de Ashtanga sin guía, para profundizar ' +
      'en tu autonomía y sostener el hábito.',
    bullets: ['Gratuita para alumnas', 'Ashtanga autoguiado', 'Comunidad'],
  },
]

export const retiros = [
  {
    title: 'Retiro de enero',
    desc:
      'Unos días para parar, respirar hondo y reconectar. Práctica diaria, descanso y ' +
      'naturaleza, en buena compañía.',
    tag: 'Próxima edición',
  },
  {
    title: 'Taller de abdomen',
    desc:
      'Trabajo profundo del core desde el Método Abdominal de Blandine Calais Germain: ' +
      'salud, conciencia y suelo pélvico.',
    tag: 'Taller',
  },
  {
    title: 'Yoga al aire libre',
    desc:
      'Practicar bajo el cielo, sobre la hierba. Sesiones especiales al aire libre cuando ' +
      'el tiempo acompaña.',
    tag: 'Estacional',
  },
]

export const pilares = [
  { title: 'Asana', desc: 'Las posturas: fuerza, flexibilidad y presencia en el cuerpo.' },
  { title: 'Pranayama', desc: 'La respiración como ancla y como medicina del sistema nervioso.' },
  { title: 'Meditación', desc: 'En movimiento y en quietud: observar, soltar, volver.' },
]

export const valores = [
  { title: 'Clases íntimas', desc: 'Grupos pequeños donde nadie pasa desapercibido.' },
  { title: 'Horarios flexibles', desc: 'Una práctica que encaja en tu vida, no al revés.' },
  { title: 'Trato personalizado', desc: 'Cada cuerpo es distinto; cada práctica también.' },
  { title: 'Cuidado en el detalle', desc: 'Tiempos de relajación y atención a lo pequeño.' },
]

export const credenciales = [
  { year: '2011', text: 'Enseñando yoga y movimiento de forma continuada.' },
  { year: '2013', text: 'Dynamic Yoga Training, 200 h — reconocida por Yoga Alliance.' },
  { year: '2019', text: 'Instrucción Profesional de Yoga, 550 h — INEF.' },
  { year: '2021', text: 'Método Abdominal de Blandine Calais Germain, 120 h.' },
]

// Placeholders (Unsplash). TODO: reemplazar por fotografías reales de Lucía.
export const fotos = {
  hero: 'https://images.unsplash.com/photo-1545205597-3d9d02c29597?q=80&w=1200&auto=format&fit=crop',
  sobreMi: 'https://images.unsplash.com/photo-1599901860904-17e6ed7083a0?q=80&w=1000&auto=format&fit=crop',
  retiro: 'https://images.unsplash.com/photo-1506126613408-eca07ce68773?q=80&w=1000&auto=format&fit=crop',
}
