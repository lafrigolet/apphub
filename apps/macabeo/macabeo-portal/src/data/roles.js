// Role selector cards (index.html). Title split into segments so the
// italic <em> accent is preserved without putting JSX in the data layer.
export const roles = [
  { to: '/invitado',       num: '01 · público',   title: { a: 'Invitado ',     em: '—',  b: ' portada' },     desc: 'Catálogo público, manifiesto y captación de socios.',  pill: 'front' },
  { to: '/socio',          num: '02 · comunidad', title: { a: 'Socio ',        em: '/',  b: ' consumidor' },  desc: 'Cesta recurrente, pedidos, impacto y asambleas.',       pill: 'front' },
  { to: '/cliente',        num: '03 · puntual',   title: { a: 'Cliente ',      em: 'puntual', b: '' },        desc: 'Compra sin cuota, con sugerencia de hacerse socio.',    pill: 'front' },
  { to: '/admin',          num: '04 · gestión',   title: { a: 'Administrador', em: '/a', b: '' },             desc: 'Cuadro de mando, socios, configuración y alertas.',     pill: 'back' },
  { to: '/gestor-pedidos', num: '05 · operación', title: { a: 'Gestor ',       em: 'de', b: ' pedidos' },     desc: 'Picking, incidencias, sustituciones, cierre.',          pill: 'back' },
  { to: '/almacen',        num: '06 · almacén',   title: { a: 'Responsable ',  em: 'de', b: ' almacén' },     desc: 'Stock, lotes, caducidades, recepciones y mermas.',      pill: 'back' },
  { to: '/comprador',      num: '07 · compras',   title: { a: 'Comprador',     em: '/a', b: '' },             desc: 'Proveedores, órdenes de compra y certificaciones.',     pill: 'back' },
  { to: '/cajero',         num: '08 · tienda',    title: { a: 'Cajero',        em: '/a', b: ' · TPV' },       desc: 'Punto de venta físico con búsqueda y socios.',          pill: 'back' },
  { to: '/repartidor',     num: '09 · ruta',      title: { a: 'Repartidor',    em: '/a', b: '' },             desc: 'Hoja de ruta, estados y prueba de entrega.',            pill: 'back' },
  { to: '/proveedor',      num: '10 · externo',   title: { a: 'Proveedor',     em: '/a', b: '' },             desc: 'Portal externo: pedidos, confirmaciones y facturas.',   pill: 'ext'  },
  { to: '/tesorero',       num: '11 · finanzas',  title: { a: 'Tesorero',      em: '/a', b: '' },             desc: 'Cuotas, facturación, impagos y exportación.',           pill: 'back' },
]

export const pillLabel = { front: 'Front office', back: 'Back office', ext: 'Portal externo' }
export const pillClass = { front: 'pill-front', back: 'pill-back', ext: 'pill-ext' }
