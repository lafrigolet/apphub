// Mock datasets extracted from the role prototypes (docs/*.html). Pure data,
// no JSX. `tone` keys map to pill classes via `pillTone` below; views that
// need bespoke icons key off `kind`/`iconTone` strings.

export const pillTone = {
  ok: 'bg-emerald-50 text-emerald-600',
  emerald: 'bg-emerald-50 text-emerald-600',
  warn: 'bg-amber-50 text-amber-600',
  amber: 'bg-amber-50 text-amber-600',
  err: 'bg-rose-50 text-rose-600',
  rose: 'bg-rose-50 text-rose-600',
  azul: 'bg-azul-50 text-azul-600',
}

// ── Emisor ────────────────────────────────────────────────────────────
// table badge labels per estado (was the `badge` map in the prototype JS)
export const emisorEstadoLabel = { ok: 'Aceptada', warn: 'Advertencia', err: 'Rechazada' }

export const emisorFacturas = [
  { serie: '2027-A/000128', cliente: 'Cliente Norte S.A.', fecha: '02-01-2027', total: '121,00 €', estado: 'ok', huella: '9B2E7C4A…FF' },
  { serie: '2027-A/000127', cliente: 'Servicios Beta', fecha: '02-01-2027', total: '847,55 €', estado: 'warn', huella: '3C9F0AB1…A1' },
  { serie: '2027-A/000126', cliente: 'Distribuciones Sur', fecha: '01-01-2027', total: '1.452,00 €', estado: 'err', huella: '77AD22E9…0C' },
  { serie: '2027-A/000125', cliente: 'Logística Oeste', fecha: '01-01-2027', total: '318,20 €', estado: 'ok', huella: '55BC91D4…7E' },
  { serie: '2027-A/000124', cliente: 'Comercial Levante', fecha: '31-12-2026', total: '990,00 €', estado: 'ok', huella: '12FE88A0…3B' },
]

export const emisorRemisiones = [
  { serie: '2027-A/000128', cliente: 'Cliente Norte S.A.', label: 'Aceptada', tone: 'ok' },
  { serie: '2027-A/000127', cliente: 'Servicios Beta', label: 'Con advertencia', tone: 'warn' },
  { serie: '2027-A/000126', cliente: 'Distribuciones Sur', label: 'Rechazada', tone: 'err' },
]

export const emisorCadena = [
  { n: 128, serie: '2027-A/000128', huella: '9B2E7C4A…FF12', anterior: '3C9F0AB1…A1', current: true },
  { n: 127, serie: '2027-A/000127', huella: '3C9F0AB1…A1', anterior: '77AD22E9…0C' },
  { n: 126, serie: '2027-A/000126', huella: '77AD22E9…0C' },
]

export const emisorEventos = [
  { tag: 'ARRANQUE', tone: 'azul', text: 'Inicio del sistema informático de facturación', ts: '02-01-2027 08:00:11' },
  { tag: 'EXPORTACIÓN', tone: 'emerald', text: 'Exportación de registros solicitada', ts: '02-01-2027 09:14:52' },
  { tag: 'ANOMALÍA', tone: 'amber', text: 'Detección de discontinuidad temporal (resuelta)', ts: '02-01-2027 11:02:30' },
  { tag: 'RESTAURACIÓN', tone: 'azul', text: 'Restauración de copia de seguridad verificada', ts: '02-01-2027 12:40:08' },
]

// ── Asesoría ──────────────────────────────────────────────────────────
export const asesoriaEstadoLabel = { ok: 'Al día', warn: 'Advertencias', err: 'Incidencia' }

export const asesoriaClientes = [
  { nombre: 'Cliente Norte S.A.', nif: 'A28000001', facturasMes: 128, estado: 'ok' },
  { nombre: 'Servicios Beta', nif: 'B33000002', facturasMes: 64, estado: 'warn' },
  { nombre: 'Distribuciones Sur', nif: 'B41000003', facturasMes: 22, estado: 'err' },
  { nombre: 'Logística Oeste', nif: 'B46000004', facturasMes: 311, estado: 'ok' },
  { nombre: 'Comercial Levante', nif: 'B03000005', facturasMes: 97, estado: 'ok' },
  { nombre: 'Talleres Centro', nif: 'B45000006', facturasMes: 45, estado: 'ok' },
]

export const asesoriaLotes = [
  { id: 'LOTE-2027-0042', info: '847 registros · 9 NIF', label: 'Completado', tone: 'ok' },
  { id: 'LOTE-2027-0043', info: '312 registros · 4 NIF', label: 'Enviando', tone: 'azul', pulse: true },
  { id: 'LOTE-2027-0041', info: '1.000 registros · 11 NIF', label: '5 advertencias', tone: 'amber' },
]

export const asesoriaRepresentacion = [
  { representado: 'Cliente Norte S.A.', nif: 'A28000001', doc: 'REPR-0012', vigencia: 'hasta 31-12-2027', estado: 'Vigente', tone: 'ok' },
  { representado: 'Servicios Beta', nif: 'B33000002', doc: 'REPR-0019', vigencia: 'hasta 30-06-2027', estado: 'Vigente', tone: 'ok' },
  { representado: 'Distribuciones Sur', nif: 'B41000003', doc: '—', vigencia: '—', estado: 'Pendiente', tone: 'amber' },
]

export const asesoriaIncidencias = [
  { ref: 'B41000003 · 2027-A/000126', tag: 'No admisible', kind: 'error', text: 'Falta campo obligatorio en el desglose. El registro no se ha incorporado: requiere corrección y reenvío.' },
  { ref: 'B33000002 · 2027-A/000127', tag: 'Admisible', kind: 'warn', text: 'Aceptada con advertencia: posible incoherencia menor en importes. No requiere reenvío.' },
]

// ── Administrador ─────────────────────────────────────────────────────
export const adminCertificados = [
  { nombre: 'Certificado del obligado · B12345678', meta: 'PKCS#12 · caduca 14-09-2027', estado: 'Vigente', tone: 'ok', iconTone: 'emerald' },
  { nombre: 'Certificado de representante', meta: 'PKCS#12 · caduca 02-03-2027', estado: 'Caduca pronto', tone: 'amber', iconTone: 'emerald' },
  { nombre: 'Certificado de pruebas (test)', meta: 'solo preportal.aeat.es', estado: 'Sandbox', tone: 'slate', iconTone: 'slate' },
]

export const adminUsuarios = [
  { initials: 'EJ', email: 'admin@ejemplo.es', rol: 'Administrador', rolPrimary: true, acceso: 'total' },
  { initials: 'MF', email: 'maria@ejemplo.es', rol: 'Emisor', rolPrimary: false, acceso: 'facturación' },
  { initials: 'GA', email: 'gestoria@asesor.es', rol: 'Representante', rolPrimary: false, acceso: 'multi-NIF' },
]

export const adminAuditoria = [
  { ts: '02-01 08:00:11', tag: 'ARRANQUE', tone: 'azul', text: 'SIF iniciado · inst. 0001' },
  { ts: '02-01 08:02:40', tag: 'LOGIN', tone: 'slate', text: 'admin@ejemplo.es · mTLS' },
  { ts: '02-01 09:14:52', tag: 'EXPORT', tone: 'emerald', text: 'Exportación de registros (1.452)' },
  { ts: '02-01 11:02:30', tag: 'ANOMALÍA', tone: 'amber', text: 'Discontinuidad temporal detectada' },
  { ts: '02-01 12:40:08', tag: 'RESTORE', tone: 'azul', text: 'Restauración verificada · cadena íntegra' },
]

// ── Desarrollador ─────────────────────────────────────────────────────
export const devTests = [
  { result: 'PASS', text: 'Alta de factura F1 con desglose IVA 21%', detail: '200 · Correcto' },
  { result: 'PASS', text: 'Encadenamiento huella SHA-256', detail: 'match vector oficial' },
  { result: 'PASS', text: 'Anulación de registro previo', detail: '200 · Correcto' },
  { result: 'FAIL', text: 'Control de flujo: respeto de TiempoEsperaEnvio', detail: 'envío anticipado' },
]

export const devEsquemas = [
  { kind: 'text', badge: 'XSD', title: 'Diseños de registro', meta: 'SuministroLR · v? (verificar)', action: 'descargar' },
  { kind: 'text', badge: 'WSDL', title: 'Servicios web', meta: 'RegFactuSistemaFacturacion', action: 'descargar' },
  { kind: 'chain', title: 'Algoritmo de huella', meta: 'SHA-256 · orden de campos', action: 'doc' },
  { kind: 'lock', title: 'Firma XAdES', meta: 'registros + eventos', action: 'doc' },
]

export const devDeclaracion = [
  { label: 'Productor del software', value: 'MI SIF S.L.', mono: false },
  { label: 'NIF', value: 'B87654321', mono: true },
  { label: 'Nombre del SIF', value: 'FacturaNode', mono: true },
  { label: 'Versión', value: '1.0 · inst. 0001', mono: true },
  { label: 'Modalidades', value: 'VERI·FACTU + No verificable', mono: false },
]
