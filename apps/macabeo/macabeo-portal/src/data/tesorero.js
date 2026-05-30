export const sidebarLinks = [
  { icon: '◐', label: 'Resumen', num: null, numClass: null, active: true },
  { icon: '◑', label: 'Cuotas socias', num: 248, numClass: null },
  { icon: '◓', label: 'Impagos', num: 7, numClass: 'danger' },
  { icon: '◧', label: 'Facturación', num: 412, numClass: null },
  { icon: '◔', label: 'Remesas SEPA', num: null, numClass: null },
];

export const sidebarOpsLinks = [
  { icon: '◌', label: 'Pagos a productoras' },
  { icon: '◍', label: 'Conciliación bancaria' },
  { icon: '◎', label: 'Exportar' },
];

export const feeSegs = [
  { n: 241, l: 'Cobradas', active: true },
  { n: 5,   l: 'En proceso', active: false },
  { n: 7,   l: 'Impagadas', active: false },
  { n: 11,  l: 'Exentas', active: false },
];

export const feeRows = [
  { avatarBg: 'var(--mb-danger)',   avatarColor: '#fff',     avatarLetter: 'N', name: 'Noa Ferreiro',   id: '#112', amt: '12,00 €', cargo: '02/05', tagClass: 'fail', tagLabel: 'Devuelto',        mandato: 'R-112-26', action: 'Reintentar' },
  { avatarBg: 'var(--mb-warning)',  avatarColor: '#3a2c08',  avatarLetter: 'X', name: 'Xosé Tovar',     id: '#156', amt: '18,00 €', cargo: '02/05', tagClass: 'late', tagLabel: '2º recordatorio', mandato: 'R-156-26', action: 'Contactar' },
  { avatarBg: 'var(--mb-muted)',    avatarColor: '#fff',     avatarLetter: 'A', name: 'Antía Pose',     id: '#089', amt: '12,00 €', cargo: '02/05', tagClass: 'late', tagLabel: '1er recordatorio', mandato: 'R-089-26', action: 'Contactar' },
  { avatarBg: 'var(--mb-primary)',  avatarColor: '#fff',     avatarLetter: 'M', name: 'Marta Vilar',    id: '#042', amt: '12,00 €', cargo: '02/05', tagClass: 'paid', tagLabel: 'Cobrada',          mandato: 'R-042-26', action: null },
  { avatarBg: 'var(--mb-accent)',   avatarColor: '#fff',     avatarLetter: 'B', name: 'Brais Lema',     id: '#018', amt: '18,00 €', cargo: '02/05', tagClass: 'paid', tagLabel: 'Cobrada',          mandato: 'R-018-26', action: null },
  { avatarBg: 'var(--mb-success)',  avatarColor: '#fff',     avatarLetter: 'S', name: 'Sabela Riveiro', id: '#073', amt: '12,00 €', cargo: '02/05', tagClass: 'paid', tagLabel: 'Cobrada',          mandato: 'R-073-26', action: null },
];

export const invoices = [
  { num: 'F-26-0142', name: 'Marta Vilar · pedido P-0138',       hint: 'emitida 18/05 · IVA 4%/10%',    am: '38,40 €',  amNeg: false },
  { num: 'F-26-0141', name: 'Iria Carballo · pedido P-0141',      hint: 'emitida 18/05 · puntual',        am: '21,40 €',  amNeg: false },
  { num: 'F-26-0140', name: 'Brais Lema · pedido P-0140',         hint: 'emitida 17/05',                  am: '62,80 €',  amNeg: false },
  { num: 'FR-26-014', name: 'Rectificativa · Noa Ferreiro',       hint: 'emitida 19/05 · anulación parcial', am: '−14,80 €', amNeg: true },
];

export const producerRows = [
  { avatarBg: 'var(--mb-primary)', avatarColor: '#fff',    avatarLetter: 'L', name: 'Horta da Lúa',    invoice: '2026-018', amt: '412,80 €', vto: '30/05', tagClass: 'pend', tagLabel: 'Programado' },
  { avatarBg: 'var(--mb-warning)', avatarColor: '#3a2c08', avatarLetter: 'M', name: 'Granxa Meixón',   invoice: '2026-024', amt: '184,40 €', vto: '30/05', tagClass: 'pend', tagLabel: 'Programado' },
  { avatarBg: 'var(--mb-accent)',  avatarColor: '#fff',    avatarLetter: 'S', name: 'Salgueiro',        invoice: '2026-019', amt: '248,60 €', vto: '02/06', tagClass: 'pend', tagLabel: 'Programado' },
  { avatarBg: 'var(--mb-muted)',   avatarColor: '#fff',    avatarLetter: 'O', name: 'O Souto',          invoice: '2026-011', amt: '168,80 €', vto: '18/05', tagClass: 'paid', tagLabel: 'Pagada' },
  { avatarBg: 'var(--mb-success)', avatarColor: '#fff',    avatarLetter: 'P', name: 'Pomares do Sil',   invoice: '2026-015', amt: '94,60 €',  vto: '20/05', tagClass: 'paid', tagLabel: 'Pagada' },
];

export const exportCards = [
  { ext: '.xml', nm: 'Facturae 3.2.2',          h: '412 facturas · firmado XAdES' },
  { ext: '.xls', nm: 'Contasol',                 h: 'Asientos por diario y serie' },
  { ext: '.csv', nm: 'Libro IVA repercutido',    h: 'Ventas · 412 registros' },
  { ext: '.csv', nm: 'Libro IVA soportado',      h: 'Compras · 28 registros' },
  { ext: '.xml', nm: 'SEPA pain.008',            h: 'Remesa adeudos directos' },
  { ext: '.pdf', nm: 'Resumen para asamblea',    h: 'Memoria económica del mes' },
];

export const sparkBars = [
  { height: '50%' },
  { height: '65%' },
  { height: '55%' },
  { height: '78%' },
  { height: '82%' },
  { height: '90%' },
];
