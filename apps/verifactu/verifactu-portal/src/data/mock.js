// Presentation constants + static reference content for the verifactu portal.
//
// The per-tenant DATA (facturas, cadena, eventos, clientes, lotes,
// representación, certificados, config, cotejos) now comes from the
// platform/verifactu API. What stays here is:
//   1. presentation maps (pill tones, estado labels) — pure UI, not data;
//   2. static reference content not backed by a table yet:
//      - asesoriaIncidencias / adminUsuarios → derivable / platform/auth (TODO wire later)
//      - devTests / devEsquemas / devDeclaracion → static AEAT reference for the dev role.

export const pillTone = {
  ok: 'bg-emerald-50 text-emerald-600',
  emerald: 'bg-emerald-50 text-emerald-600',
  warn: 'bg-amber-50 text-amber-600',
  amber: 'bg-amber-50 text-amber-600',
  err: 'bg-rose-50 text-rose-600',
  rose: 'bg-rose-50 text-rose-600',
  azul: 'bg-azul-50 text-azul-600',
}

export const emisorEstadoLabel = { ok: 'Aceptada', warn: 'Advertencia', err: 'Rechazada' }
export const asesoriaEstadoLabel = { ok: 'Al día', warn: 'Advertencias', err: 'Incidencia' }

// ── Static reference (no backing table yet) ───────────────────────────

// TODO(wire): derivable de registros con estado warn/err — de momento estático.
export const asesoriaIncidencias = [
  { ref: 'B41000003 · 2027-A/000126', tag: 'No admisible', kind: 'error', text: 'Falta campo obligatorio en el desglose. El registro no se ha incorporado: requiere corrección y reenvío.' },
  { ref: 'B33000002 · 2027-A/000127', tag: 'Admisible', kind: 'warn', text: 'Aceptada con advertencia: posible incoherencia menor en importes. No requiere reenvío.' },
]

// TODO(wire): usuarios vienen de platform/auth (REUSE) cuando se cablee el login.
export const adminUsuarios = [
  { initials: 'EJ', email: 'admin@ejemplo.es', rol: 'Administrador', rolPrimary: true, acceso: 'total' },
  { initials: 'MF', email: 'maria@ejemplo.es', rol: 'Emisor', rolPrimary: false, acceso: 'facturación' },
  { initials: 'GA', email: 'gestoria@asesor.es', rol: 'Representante', rolPrimary: false, acceso: 'multi-NIF' },
]

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
