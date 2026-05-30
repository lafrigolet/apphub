export const QUEUE_ORDERS = [
  { id: 'P-2026-0142', name: 'Marta Vilar · Socia #042', status: 'prog', statusLabel: 'En curso', lines: 7, amount: '38,40 €', pickup: 'local · 18:00' },
  { id: 'P-2026-0141', name: 'Iria Carballo · puntual',   status: 'todo', statusLabel: 'Pendiente', lines: 4, amount: '21,40 €', pickup: 'local · 18:00' },
  { id: 'P-2026-0143', name: 'Brais Lema · Socio #018',  status: 'todo', statusLabel: 'Pendiente', lines: 11, amount: '62,80 €', pickup: 'domicilio' },
  { id: 'P-2026-0144', name: 'Sabela Riveiro · Socia #073', status: 'todo', statusLabel: 'Pendiente', lines: 6, amount: '34,20 €', pickup: 'local · 19:00' },
  { id: 'P-2026-0145', name: 'Noa Ferreiro · Socia #112', status: 'done', statusLabel: 'Listo',     lines: 3, amount: '14,80 €', pickup: 'local · 18:00' },
  { id: 'P-2026-0146', name: 'Xosé Tovar · Socio #156',  status: 'todo', statusLabel: 'Pendiente', lines: 9, amount: '48,60 €', pickup: 'local · 19:00' },
];

export const ACTIVE_ORDER = {
  avatar: 'M',
  name: 'Marta Vilar',
  id: 'P-2026-0142',
  sub: '7 líneas · 38,40 € · recogida local jue 18:00–20:00',
};

export const PICKING_ZONES = [
  {
    zone: 'Zona A · Frescos',
    count: 2,
    lines: [
      { sku: 'FR-TKM-01', name: 'Tomate kumato',   location: 'A-2-3', supplier: 'Horta da Lúa', lot: 'Lote L26-0518', qty: '2', unit: '× 500g', status: 'done' },
      { sku: 'FR-LRO-02', name: 'Lechuga roble',   location: 'A-2-1', supplier: 'Horta da Lúa', lot: null,            qty: '3', unit: 'uds',    status: 'done' },
    ],
  },
  {
    zone: 'Zona B · Lácteo',
    count: 2,
    lines: [
      { sku: 'LC-QCN-04', name: 'Queso curado nuevo', location: 'B-1-2', supplier: 'Granxa Meixón', lot: 'Lote 26-0511 · cad 12/07', qty: '1', unit: '× 300g', status: 'done' },
      {
        sku: null, name: 'Yogur natural', location: null, supplier: null, lot: null,
        qty: '2', unit: 'de 4', status: 'issue',
        issueText: 'Solo quedan 2 unidades, pedido 4 · sustituto sugerido: ',
        issueSubstitute: 'Yogur de cabra (Meixón)',
        subsText: '2 yogures de cabra de Meixón (+0,40 € en total). La socia tiene preferencia "avisar antes de sustituir" — se enviará SMS automático al confirmar.',
      },
    ],
  },
  {
    zone: 'Zona C · Granel',
    count: 1,
    lines: [
      { sku: 'GR-GBC-09', name: 'Garbanzo castellano · granel', location: 'C-3-1', supplier: 'Salgueiro Cereais', lot: 'Pesar 600g (tolerancia ±5%)', qty: '600', unit: 'g', status: 'pending' },
    ],
  },
  {
    zone: 'Zona D · Despensa & panadería',
    count: 2,
    lines: [
      { sku: 'PN-CAV-12', name: 'Pan caaveiro', location: 'D-1-1', supplier: 'Forno O Marqués', lot: null, qty: '2', unit: '× 500g', status: 'pending' },
      { sku: 'BV-SID-18', name: 'Sidra natural', location: 'D-4-3', supplier: 'Llagar Asturia',  lot: null, qty: '1', unit: '× 75cl', status: 'pending' },
    ],
  },
];
