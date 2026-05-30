export const pipelineColumns = [
  {
    label: 'Borrador',
    count: 4,
    cards: [
      { code: 'OC-026-082', name: 'Horta da Lúa',      meta: '14 líneas',         amount: '248,50 €', variant: '' },
      { code: 'OC-026-081', name: 'Salgueiro Cereais', meta: '6 líneas · urge',   amount: '412,00 €', variant: 'warn' },
      { code: 'OC-026-080', name: 'Forno O Marqués',   meta: '3 líneas',          amount: '84,40 €',  variant: '' },
      { code: 'OC-026-079', name: 'O Souto',           meta: '2 líneas',          amount: '168,00 €', variant: '' },
    ],
  },
  {
    label: 'Enviada',
    count: 5,
    cards: [
      { code: 'OC-026-078', name: 'Granxa Meixón',    meta: '↳ 4 días sin resp.', amount: '312,00 €', variant: 'urg' },
      { code: 'OC-026-077', name: 'Pomares do Sil',   meta: 'enviada ayer',        amount: '184,60 €', variant: '' },
      { code: 'OC-026-076', name: 'Llagar Asturia',   meta: 'enviada lun',         amount: '96,00 €',  variant: '' },
      { code: 'OC-026-075', name: 'Cooperativa Vall', meta: 'enviada lun',         amount: '462,40 €', variant: '' },
      { code: 'OC-026-074', name: 'Casa Pepa',        meta: 'enviada dom',         amount: '72,00 €',  variant: '' },
    ],
  },
  {
    label: 'Confirmada',
    count: 6,
    cards: [
      { code: 'OC-026-073', name: 'Horta da Lúa',     meta: 'entrega mié 21', amount: '198,40 €', variant: 'ok' },
      { code: 'OC-026-072', name: 'Granxa Meixón',    meta: 'entrega vie 23', amount: '284,00 €', variant: 'ok' },
      { code: 'OC-026-071', name: 'Salgueiro',        meta: 'entrega lun 26', amount: '340,00 €', variant: 'ok' },
      { code: 'OC-026-070', name: 'O Souto',          meta: 'entrega mar 27', amount: '168,80 €', variant: 'ok' },
      { code: 'OC-026-069', name: 'Casa Pepa',        meta: 'entrega jue 22', amount: '54,60 €',  variant: 'ok' },
      { code: 'OC-026-068', name: 'Forno O Marqués',  meta: 'entrega vie 23', amount: '92,40 €',  variant: 'ok' },
    ],
  },
  {
    label: 'Recibida',
    count: 3,
    cards: [
      { code: 'OC-026-067', name: 'Pomares do Sil',  meta: 'conformada 20/05', amount: '164,40 €', variant: 'ok' },
      { code: 'OC-026-066', name: 'Horta da Lúa',    meta: 'conformada 19/05', amount: '212,80 €', variant: 'ok' },
      { code: 'OC-026-065', name: 'Llagar Asturia',  meta: 'conformada 18/05', amount: '96,00 €',  variant: 'ok' },
    ],
  },
];

export const providers = [
  {
    letter: 'L',
    avatarBg: 'var(--mb-primary)',
    avatarColor: '#fff',
    name: 'Horta da Lúa',
    location: 'Betanzos · 18 km',
    stars: 5,
    certs: [
      { label: 'CRAEGA', expiring: false },
      { label: 'Km 0', expiring: false },
    ],
    annual: '3.840 €',
    orders: '42',
    delay: '0%',
  },
  {
    letter: 'M',
    avatarBg: 'var(--mb-warning)',
    avatarColor: '#3a2c08',
    name: 'Granxa Meixón',
    location: 'Curtis · 32 km',
    stars: 4,
    certs: [
      { label: 'CRAEGA', expiring: false },
      { label: 'Bienestar', expiring: false },
    ],
    annual: '6.420 €',
    orders: '36',
    delay: '4%',
  },
  {
    letter: 'S',
    avatarBg: 'var(--mb-accent)',
    avatarColor: '#fff',
    name: 'Salgueiro Cereais',
    location: 'Lalín · 64 km',
    stars: 5,
    certs: [
      { label: 'CRAEGA', expiring: false },
      { label: 'Variedad local', expiring: false },
    ],
    annual: '4.180 €',
    orders: '28',
    delay: '0%',
  },
  {
    letter: 'O',
    avatarBg: 'var(--mb-muted)',
    avatarColor: '#fff',
    name: 'O Souto',
    location: 'Quiroga · 184 km',
    stars: 4,
    certs: [
      { label: 'CRAEGA cad. 18d', expiring: true },
    ],
    annual: '2.860 €',
    orders: '14',
    delay: '7%',
  },
];

export const suggestions = [
  {
    name: 'Tomate kumato',
    hint: 'Stock 3,2 kg · mín 10 kg · Horta da Lúa',
    qty: 18,
    unit: 'kg',
  },
  {
    name: 'Yogur natural',
    hint: 'Stock 14 uds · mín 40 uds · Granxa Meixón',
    qty: 60,
    unit: 'uds',
  },
  {
    name: 'Garbanzo castellano',
    hint: 'Stock 9,8 kg · mín 20 kg · Salgueiro',
    qty: 25,
    unit: 'kg',
  },
  {
    name: 'Lechuga roble',
    hint: 'Stock 8 uds · mín 15 uds · Horta da Lúa',
    qty: 20,
    unit: 'uds',
  },
];

export const comparators = [
  { name: 'Salgueiro Cereais', price: '3,80', unit: '€/kg', note: '✓ recomendado · 64 km', win: true },
  { name: 'Cooperativa Vall',  price: '4,20', unit: '€/kg', note: '+10% · 320 km',          win: false },
  { name: 'A Eira da Bouza',   price: '4,60', unit: '€/kg', note: '+21% · 142 km',          win: false },
];
