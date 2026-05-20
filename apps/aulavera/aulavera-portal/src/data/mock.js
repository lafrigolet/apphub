// Mock data extracted from the prototype aulavera.html.
// Replace these with real API calls when /Implementa aulavera generates the backend.

export const futuros = [
  {
    id: 'terapia-animales',
    title: 'Terapias con animales',
    when: 'Próximamente · agenda abierta',
    area: 'Educación',
    body: 'Las terapias con animales facilitan una mejoría en niños y adultos con discapacidades. La equinoterapia es especialmente recomendable para autismo, parálisis cerebral y síndrome Down.',
    img: 'cow',
    price: 'Reservar (señal 25 €)',
  },
  {
    id: 'ruta-caballo',
    title: 'Ruta a caballo por la Vera',
    when: 'Sábados · primavera 2026',
    area: 'Arte y cultura',
    body: 'Recorrido guiado por caminos rurales con un grupo reducido. Aprenderemos a relacionarnos con el caballo desde el respeto.',
    img: 'vega',
    price: 'Reservar (señal 30 €)',
  },
  {
    id: 'bio-construccion',
    title: 'Construye una casa (bio-construcción)',
    when: 'Taller de 3 días',
    area: 'Agronomía',
    body: 'Iniciación a la bio-construcción con materiales locales: barro, paja, madera. Manos a la obra.',
    img: 'olives',
    price: 'Reservar (señal 40 €)',
  },
  {
    id: 'pozas',
    title: 'Excursión a las pozas',
    when: 'Verano 2026',
    area: 'Educación',
    body: 'Caminata familiar hasta las gargantas más cercanas, baño y picnic. Apta para todas las edades.',
    img: 'river',
    price: 'Reservar (señal 15 €)',
  },
  {
    id: 'cineforum',
    title: 'Cine fórum: paisajes y memoria',
    when: 'Viernes mensuales',
    area: 'Arte y cultura',
    body: 'Proyección y conversación abierta. Patrimonio cultural y rural a través del cine.',
    img: 'frog',
    price: 'Reservar (señal 10 €)',
  },
]

export const ideas = [
  'Ruta a caballo',
  'Bio-construcción',
  'Excursión a las pozas',
  'Visita intergeneracional',
  'Reeducación escritural',
  'Orientación y supervivencia',
  'Cine fórum',
  'Baile (claqué)',
  'Tiro con arco',
  'Esgrima',
  'Aprende a escribir',
  'Cocina lenta',
]

export const disciplines = [
  { name: 'Terapia con animales', state: 'En preparación', body: 'Equinoterapia y otras intervenciones asistidas con animales.', icon: '🐎' },
  { name: 'Grafomotricidad & reeducación escritural', state: 'Consolidada', body: 'Talleres impartidos por especialistas en escritura.', icon: '✍︎' },
  { name: 'Bio-construcción', state: 'En preparación', body: 'Aprendizaje con materiales locales y técnicas tradicionales.', icon: '⌂' },
  { name: 'Convivencias intergeneracionales', state: 'Consolidada', body: 'En colaboración con Servimayor: encuentros, lecturas, comidas conjuntas.', icon: '◐' },
]

export const videos = [
  { t: 'Taller de grafomotricidad — sesión 1', s: '14:32 · 7 jun 2025' },
  { t: 'Trovador en Servimayor — El Alquimista', s: '08:45 · 7 jun 2025' },
  { t: 'Recorrido por la finca — primavera', s: '06:12 · 12 abr 2025' },
]

export const recursos = [
  { t: 'Guía pedagógica · convivencias intergeneracionales', s: 'PDF · 24 págs.' },
  { t: 'Plantilla de evaluación de talleres', s: 'DOCX · 4 págs.' },
  { t: 'Pack de imágenes propias (uso interno)', s: 'ZIP · 142 MB' },
  { t: 'Lista de poemas seleccionados', s: 'PDF · 8 págs.' },
]

export const documentos = [
  { ic: '📜', ttl: 'Estatutos de la Fundación', sub: 'Última actualización · 2025' },
  { ic: '📊', ttl: 'Memoria 2024', sub: 'PDF · 32 págs.' },
  { ic: '⚖', ttl: 'Plan estratégico 2025-2028', sub: 'Documento de trabajo' },
]

export const collaborators = [
  'Residencia Servimayor',
  'COCEMFE Cáceres',
  'Adiscasar',
  'Asociación Novaforma',
]
