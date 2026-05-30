export const PENDING_ORDERS = [
  {
    id: 'OC-026-078',
    buyer: 'Macabeo S.Coop.G',
    buyerSub: 'Cambre',
    received: 'recibido lun 18 may · entrega solicitada vie 23 may',
    lines: [
      { name: 'Queso curado nuevo',  qty: '12 uds × 300g',   price: '156,00 €' },
      { name: 'Yogur natural',       qty: '120 uds × 125g',  price: '102,00 €' },
      { name: 'Mantequilla curada',  qty: '8 uds × 250g',    price: '54,00 €' },
    ],
    total: '312,00 €',
    confirmed: false,
    actions: ['propose', 'postpone', 'confirm'],
  },
  {
    id: 'OC-026-072',
    buyer: 'Macabeo',
    buyerSub: 'entrega mar 27',
    received: 'recibido vie 15 may',
    lines: [
      { name: 'Yogur de cabra', qty: '60 uds × 125g',  price: '90,00 €' },
      { name: 'Queso fresco',   qty: '14 uds × 200g',  price: '96,00 €' },
    ],
    total: '186,00 €',
    confirmed: false,
    actions: ['detail', 'confirm'],
  },
  {
    id: 'OC-026-065',
    buyer: 'Macabeo',
    buyerSub: 'entregado',
    received: 'conformado lun 18 may',
    lines: [],
    total: '184,40 €',
    confirmed: true,
    actions: ['albaran', 'invoice'],
  },
];

export const CERTIFICATES = [
  {
    status: 'warn',
    icon: '!',
    name: 'CRAEGA · ecológico',
    hint: 'Nº G-2147 · vence 08/06/2026',
    label: '18 días',
  },
  {
    status: 'ok',
    icon: '✓',
    name: 'Bienestar animal · AENOR',
    hint: 'Nº BA-0894 · vence 14/02/2027',
    label: 'vigente',
  },
  {
    status: 'ok',
    icon: '✓',
    name: 'Registro sanitario lácteo',
    hint: 'RGSEAA · 15.30148/C',
    label: 'vigente',
  },
  {
    status: 'exp',
    icon: '×',
    name: 'Análisis aguas pozo 2025',
    hint: 'Caducado el 02/03/2026',
    label: 'caducado',
  },
];

export const UPLOADED_FILES = [
  { type: 'PDF', name: 'Albarán OC-026-065',     date: 'subido el 18/05', size: '412 KB' },
  { type: 'PDF', name: 'Análisis lactosa abril',  date: 'subido el 02/05', size: '1,2 MB' },
];

export const ORDER_HISTORY = [
  { oc: 'OC-026-072', date: '15/05/2026', lines: 2, amount: '186,00 €', status: 'pend', statusLabel: 'A confirmar', invoice: null,          payment: null },
  { oc: 'OC-026-078', date: '18/05/2026', lines: 3, amount: '312,00 €', status: 'pend', statusLabel: 'A confirmar', invoice: null,          payment: null },
  { oc: 'OC-026-065', date: '02/05/2026', lines: 4, amount: '184,40 €', status: 'ok',   statusLabel: 'Entregado',   invoice: 'F-26-0142',   payment: 'Pagado 12/05' },
  { oc: 'OC-026-051', date: '18/04/2026', lines: 3, amount: '248,80 €', status: 'ok',   statusLabel: 'Entregado',   invoice: 'F-26-0118',   payment: 'Pagado 30/04' },
  { oc: 'OC-026-038', date: '04/04/2026', lines: 5, amount: '342,60 €', status: 'ok',   statusLabel: 'Entregado',   invoice: 'F-26-0094',   payment: 'Pagado 16/04' },
  { oc: 'OC-026-022', date: '21/03/2026', lines: 4, amount: '198,40 €', status: 'ok',   statusLabel: 'Entregado',   invoice: 'F-26-0068',   payment: 'Pagado 02/04' },
];
