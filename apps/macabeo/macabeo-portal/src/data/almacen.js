export const expiryItems = [
  { id: 1, days: 2, window: 3, name: 'Yogur natural · Granxa Meixón', lot: 'L26-0514 · cad 23/05 · B-1-4', qty: '14', unit: 'uds' },
  { id: 2, days: 3, window: 3, name: 'Lechuga roble · Horta da Lúa', lot: 'L26-0515 · cad 24/05 · A-2-1', qty: '8', unit: 'uds' },
  { id: 3, days: 5, window: 7, name: 'Pan caaveiro · Forno O Marqués', lot: 'L26-0516 · cad 26/05 · D-1-1', qty: '6', unit: 'uds' },
  { id: 4, days: 6, window: 7, name: 'Tomate kumato · Horta da Lúa', lot: 'L26-0518 · cad 27/05 · A-2-3', qty: '3,2', unit: 'kg' },
  { id: 5, days: 12, window: 15, name: 'Queso curado · Granxa Meixón', lot: 'L26-0501 · cad 02/06 · B-1-2', qty: '2', unit: 'uds' },
];

export const stockRows = [
  { sku: 'FR-TKM-01', name: 'Tomate kumato', supplier: 'Horta da Lúa', loc: 'A-2-3', lot: 'L26-0518 · 27/05', stock: '3,2 kg', min: '10 kg', pct: 18, level: 'cr' },
  { sku: 'LC-YGN-04', name: 'Yogur natural', supplier: 'Granxa Meixón', loc: 'B-1-4', lot: 'L26-0514 · 23/05', stock: '14 uds', min: '40 uds', pct: 24, level: 'cr' },
  { sku: 'FR-LRO-02', name: 'Lechuga roble', supplier: 'Horta da Lúa', loc: 'A-2-1', lot: 'L26-0515 · 24/05', stock: '8 uds', min: '15 uds', pct: 42, level: 'lo' },
  { sku: 'GR-GBC-09', name: 'Garbanzo castellano', supplier: 'Salgueiro Cereais', loc: 'C-3-1', lot: 'L26-0420', stock: '9,8 kg', min: '20 kg', pct: 48, level: 'lo' },
  { sku: 'PN-CAV-12', name: 'Pan caaveiro', supplier: 'Forno O Marqués', loc: 'D-1-1', lot: 'L26-0516 · 26/05', stock: '24 uds', min: '15 uds', pct: 78, level: 'ok' },
];

export const zones = [
  { key: 'A', title: 'A · Frescos', sub: 'huerta y fruta', n: 68, total: '120 ud', pct: 57, fillColor: 'var(--mb-warning)' },
  { key: 'B', title: 'B · Lácteo', sub: 'cámara 4 °C', n: 42, total: '80 ud', pct: 52, fillColor: null },
  { key: 'C', title: 'C · Granel', sub: 'silos & dispensadores', n: 112, total: '180 kg', pct: 62, fillColor: null },
  { key: 'D', title: 'D · Despensa', sub: 'seco y panadería', n: 198, total: '220 ud', pct: 90, fillColor: 'var(--mb-danger)' },
];

export const mermaRows = [
  { date: '20/05', name: 'Lechuga roble · 4 uds', reason: 'caducidad', amount: '−9,40 €' },
  { date: '19/05', name: 'Yogur natural · 6 uds', reason: 'vidrio roto', amount: '−7,20 €' },
  { date: '18/05', name: 'Pan caaveiro · 2 uds', reason: 'caducidad', amount: '−8,40 €' },
  { date: '17/05', name: 'Tomate kumato · 1,8 kg', reason: 'deterioro', amount: '−12,24 €' },
  { date: '15/05', name: 'Huevos campero · 3 uds', reason: 'rotura', amount: '−1,12 €' },
];
