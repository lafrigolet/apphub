// Role selector cards (index.html). JSX-free: the per-card SVG icon lives in
// RoleSelector keyed by `id`. `badge.primary` flags the azul "Principal" tag;
// the rest use the slate style.
export const roles = [
  {
    id: 'emisor',
    to: '/emisor',
    title: 'Emisor / Obligado',
    badge: { label: 'Principal', primary: true },
    desc: 'Emite facturas, consulta el estado de remisión y verifica la integridad de tu cadena de registros.',
    bullets: ['Emisión y anulación', 'Estado de envíos AEAT', 'Cadena de huellas + QR'],
  },
  {
    id: 'asesoria',
    to: '/asesoria',
    title: 'Asesoría / Representante',
    badge: { label: 'Multi-NIF' },
    desc: 'Gestiona la facturación de tu cartera de clientes y remite en su nombre mediante apoderamiento.',
    bullets: ['Cartera de clientes', 'Remisiones por lote', 'Representación de terceros'],
  },
  {
    id: 'desarrollador',
    to: '/desarrollador',
    title: 'Desarrollador / Fabricante',
    badge: { label: 'SIF' },
    desc: 'Valida tu integración en el entorno de pruebas, gestiona esquemas y la declaración responsable.',
    bullets: ['Portal de pruebas', 'Esquemas XSD / WSDL', 'Declaración responsable'],
  },
  {
    id: 'administrador',
    to: '/administrador',
    title: 'Administrador',
    badge: { label: 'Sistema' },
    desc: 'Configura certificados, usuarios, control de flujo de la AEAT y revisa la auditoría de eventos del SIF.',
    bullets: ['Certificados y mTLS', 'Usuarios y permisos', 'Auditoría / eventos'],
  },
  {
    id: 'receptor',
    to: '/receptor',
    title: 'Receptor',
    badge: { label: 'Cotejo' },
    desc: 'Verifica la autenticidad de una factura recibida escaneando su QR o introduciendo la URL de cotejo.',
    bullets: ['Verificación por QR', 'Cotejo en sede AEAT', 'Historial de comprobaciones'],
  },
]
