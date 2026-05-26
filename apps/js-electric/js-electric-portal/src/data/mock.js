// Contenido estático del landing — extraído del prototipo HTML.
// Cada array es candidato a tabla / endpoint cuando llegue Implementa.

export const stats = [
  { target: 15,   suffix: '+', label: 'años activos' },
  { target: 2400, suffix: '+', label: 'instalaciones' },
  { target: 98,   suffix: '%', label: 'satisfacción' },
]

export const tickerItems = [
  'Instalaciones Eléctricas',
  'Aire Acondicionado',
  'Placas Solares',
  'Cargadores VE',
  'Domótica',
  'Mantenimientos',
]

export const services = [
  {
    num:     '01',
    title:   'Instalaciones eléctricas',
    desc:    'Nuevas instalaciones, reformas, boletines y legalizaciones. Cuadros, líneas, puesta a tierra, iluminación técnica y decorativa.',
    bullets: ['Viviendas y locales', 'Boletines CIE', 'BT / IT industrial'],
    iconPath: 'M13 2L4 14h6l-1 8 9-12h-6l1-8z',
  },
  {
    num:     '02',
    title:   'Aire acondicionado',
    desc:    'Climatización eficiente: split, multisplit, conductos y aerotermia. Diseño térmico, instalación y mantenimiento.',
    bullets: ['Inverter A+++', 'Aerotermia', 'Carnet RITE'],
    iconPath: 'M3 7h18M3 12h18M3 17h12M19 17l-2-2m2 2l-2 2',
  },
  {
    num:        '03',
    title:      'Placas solares',
    desc:       'Autoconsumo fotovoltaico llave en mano. Estudio, legalización, tramitación de ayudas y monitorización 24/7.',
    bullets:    ['Residencial e industrial', 'Baterías y vertido', 'Subvenciones Next Gen'],
    highlighted: true,
    badge:      '★ Más solicitado',
    ctaHref:    '#calculadora',
    ctaLabel:   'Calcular ahorro',
  },
  {
    num:     '04',
    title:   'Cargadores VE',
    desc:    'Puntos de recarga para vehículo eléctrico en garajes privados, comunidades y empresas. Carga inteligente y solar.',
    bullets: ['Wallbox, V2H, OCPP', 'Carga compartida', 'MOVES III'],
    iconPath: 'M5 11V7a2 2 0 012-2h6a2 2 0 012 2v12a2 2 0 01-2 2H7a2 2 0 01-2-2v-4M5 11h6m-6 4h6M17 9l3 3-3 3',
  },
  {
    num:     '05',
    title:   'Domótica & IoT',
    desc:    'Hogar y oficina conectados. Iluminación, climatización, persianas y consumos bajo control desde tu móvil.',
    bullets: ['KNX · Loxone · Shelly', 'Asistentes de voz', 'Monitor energético'],
    iconPath: 'M4 7h16M4 12h16M4 17h16',
  },
  {
    num:     '06',
    title:   'Mantenimientos',
    desc:    'Contratos de mantenimiento preventivo y correctivo para comunidades, locales e industrias. SAT 24/7.',
    bullets: ['Revisiones OCA', 'Urgencias 24h', 'Termografías'],
    iconPath: 'M9 12l2 2 4-4M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  },
]

export const projects = [
  {
    cls:    'md:col-span-4 md:row-span-2 h-[340px] md:h-[520px]',
    img:    'https://images.unsplash.com/photo-1509391366360-2e959784a276?auto=format&fit=crop&w=1400&q=80',
    kicker: 'Fotovoltaica residencial',
    title:  'Villa Mediterránea · 9,2 kWp',
    desc:   'Autoconsumo con baterías LiFePO₄ y cargador VE. Cubierta -73% factura anual.',
    featured: true,
  },
  {
    cls:    'md:col-span-2 h-[240px] md:h-[250px]',
    img:    'https://images.unsplash.com/photo-1473341304170-971dccb5ac1e?auto=format&fit=crop&w=900&q=80',
    kicker: 'Climatización',
    title:  'Oficinas Triton',
  },
  {
    cls:    'md:col-span-2 h-[240px] md:h-[250px]',
    img:    'https://images.unsplash.com/photo-1593941707882-a5bba14938c7?auto=format&fit=crop&w=900&q=80',
    kicker: 'Movilidad eléctrica',
    title:  'Parking 32 puntos',
  },
  {
    cls:    'md:col-span-3 h-[240px]',
    img:    'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=1200&q=80',
    kicker: 'Industrial',
    title:  'Nave logística Norte',
  },
  {
    cls:    'md:col-span-3 h-[240px]',
    img:    'https://images.unsplash.com/photo-1558002038-1055907df827?auto=format&fit=crop&w=1200&q=80',
    kicker: 'Domótica',
    title:  'Loft Centro · KNX',
  },
]

export const calculadoraInfo = [
  'Cálculo basado en irradiación media peninsular (1.650h equivalentes/año)',
  'Precio orientativo de instalación: 1.200€/kWp llave en mano',
  'Resultado estimativo. Para presupuesto exacto, contacta con nosotros',
]

export const testimonials = [
  {
    avatar:    'MR',
    avatarCls: 'bg-ink-900 text-white',
    name:      'Marta Ramírez',
    role:      'Particular · Sevilla',
    text:      'Cambiamos la instalación entera de casa y pusimos placas. Trabajo limpio, tiempos cumplidos, y la app para ver el consumo es una maravilla.',
  },
  {
    avatar:    'JT',
    avatarCls: 'bg-electric-500 text-white',
    name:      'Javier Torres',
    role:      'Logística Ártica S.L.',
    text:      'Instalaron 14 puntos de recarga en nuestro parking de empresa. Gestionaron la subvención MOVES y el alta sin que tuviéramos que mover un dedo.',
  },
  {
    avatar:    'LP',
    avatarCls: 'bg-electric-300 text-ink-900',
    name:      'Laura Pérez',
    role:      'Particular · Madrid',
    text:      'Nos pusieron aerotermia y multisplit en toda la casa. La factura ha bajado a la mitad y el equipo técnico es de 10. Repetiremos seguro.',
  },
]

export const certifications = ['FENIE', 'UNEF', 'ISO 9001', 'RD 244/2019', 'RITE', 'IDAE']

export const valores = [
  {
    title: 'Plazos cumplidos',
    desc:  'Compromiso por escrito. Si nos retrasamos, te bonificamos.',
    iconPath: 'M12 8v4l3 3M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  },
  {
    title: 'Garantía 10 años',
    desc:  'En instalación y materiales. Atención post-venta real.',
    iconPath: 'M9 12l2 2 4-4M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  },
  {
    title: 'Presupuesto claro',
    desc:  'Sin letra pequeña. Lo que firmas es lo que pagas.',
    iconPath: 'M12 2l9 4.5v9L12 20l-9-4.5v-9L12 2z M12 2v18 M3 6.5l9 4.5 9-4.5',
  },
  {
    title: 'Llave en mano',
    desc:  'Nos ocupamos de todo: trámites, ayudas y legalización.',
    iconPath: 'M13 2L4 14h6l-1 8 9-12h-6l1-8z',
  },
]

export const blogPosts = [
  {
    img:     'https://images.unsplash.com/photo-1611365892117-bce8cd8b6262?auto=format&fit=crop&w=800&q=80',
    kicker:  'Guía · 8 min',
    title:   '¿Compensa instalar baterías solares en 2026? Análisis real',
    excerpt: 'Repasamos amortización, ciclos de vida y casos donde sí (y donde no) tiene sentido.',
  },
  {
    img:     'https://images.unsplash.com/photo-1632833239869-a37e3a5806d2?auto=format&fit=crop&w=800&q=80',
    kicker:  'Subvenciones · 6 min',
    title:   'Cómo pedir el MOVES III para tu cargador VE paso a paso',
    excerpt: 'Documentación, plazos y cuánto tarda en llegar el dinero. La realidad sin marketing.',
  },
  {
    img:     'https://images.unsplash.com/photo-1556761175-5973dc0f32e7?auto=format&fit=crop&w=800&q=80',
    kicker:  'Climatización · 5 min',
    title:   'Aerotermia vs caldera de gas: ¿qué te ahorra más al año?',
    excerpt: 'Comparativa con datos reales en vivienda media de 100m². Te sorprenderá.',
  },
]

export const contactInfo = {
  phone:    '900 123 456',
  phoneHref: 'tel:+34900123456',
  email:    'hola@jselectric.es',
  emailHref: 'mailto:hola@jselectric.es',
  whatsapp: '+34 600 000 000',
  whatsappHref: 'https://wa.me/34600000000',
  office:   'C/ Energía 42, Madrid',
}

export const formServices = [
  { id: 'Eléctrica',     label: '⚡ Eléctrica' },
  { id: 'Aire',          label: '❄ Aire acond.' },
  { id: 'Solar',         label: '☀ Solar' },
  { id: 'VE',            label: '🔌 Cargador VE' },
  { id: 'Domótica',      label: '🏠 Domótica' },
  { id: 'Mantenimiento', label: '🛠 Manten.' },
]

export const navLinks = [
  { href: '#servicios',   label: 'Servicios' },
  { href: '#proyectos',   label: 'Proyectos' },
  { href: '#calculadora', label: 'Ahorro Solar' },
  { href: '#empresa',     label: 'Empresa' },
  { href: '#blog',        label: 'Recursos' },
]

export const footerCols = [
  {
    title: 'Servicios',
    items: [
      { label: 'Eléctricas',    href: '#servicios' },
      { label: 'Climatización', href: '#servicios' },
      { label: 'Fotovoltaica',  href: '#servicios' },
      { label: 'Cargadores VE', href: '#servicios' },
      { label: 'Domótica',      href: '#servicios' },
    ],
  },
  {
    title: 'Empresa',
    items: [
      { label: 'Sobre nosotros',       href: '#empresa' },
      { label: 'Proyectos',            href: '#proyectos' },
      { label: 'Blog',                 href: '#blog' },
      { label: 'Trabaja con nosotros', href: '#' },
      { label: 'Contacto',             href: '#contacto' },
    ],
  },
  {
    title: 'Legal',
    items: [
      { label: 'Aviso legal', href: '#' },
      { label: 'Privacidad',  href: '#' },
      { label: 'Cookies',     href: '#' },
      { label: 'Condiciones', href: '#' },
    ],
  },
]
