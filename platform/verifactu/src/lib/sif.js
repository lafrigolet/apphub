import { huellaEvento } from './huella.js'

// Identidad del Sistema Informático de Facturación (SIF) y eventos del sistema.
//
// ⚠️ VERIFICAR — el catálogo de eventos OBLIGATORIOS y sus códigos se toman de
// la Orden HAC/1177/2024 (no extraído de fuente oficial todavía). La identidad
// del SIF (productor, versión, nº instalación) es la del prototipo demo
// (FacturaNode); en real saldría de la declaración responsable del fabricante.

export const SIF_IDENTITY = {
  nif: 'B87654321',            // NIF del productor del software
  nombre: 'MI SIF S.L.',
  idSistemaInformatico: '01',
  nombreSistemaInformatico: 'FacturaNode',
  version: '1.0',
  numeroInstalacion: '0001',
}

// Catálogo de tipos de evento + tono para el pill del portal. (verificar)
export const EVENTOS_CATALOGO = [
  { tipo: 'ARRANQUE',     tone: 'azul',    descripcion: 'Inicio del sistema informático de facturación' },
  { tipo: 'RESTAURACION', tone: 'azul',    descripcion: 'Restauración de copia de seguridad verificada' },
  { tipo: 'EXPORTACION',  tone: 'emerald', descripcion: 'Exportación de registros solicitada' },
  { tipo: 'ANOMALIA',     tone: 'amber',   descripcion: 'Detección de discontinuidad/anomalía' },
  { tipo: 'LOGIN',        tone: 'slate',   descripcion: 'Acceso al sistema' },
]

const PORTipo = new Map(EVENTOS_CATALOGO.map((e) => [e.tipo, e]))

export function esTipoValido(tipo) {
  return PORTipo.has(tipo)
}

export function toneDe(tipo) {
  return PORTipo.get(tipo)?.tone ?? 'azul'
}

// Construye un RegistroEvento con su huella encadenada (pure, sin DB).
// `obligadoNif` del config; `huellaAnterior` la del evento previo (null = primero).
export function construirEvento({ tipoEvento, descripcion, obligadoNif, generadoEn }, huellaAnterior) {
  const cat = PORTipo.get(tipoEvento)
  const desc = descripcion ?? cat?.descripcion ?? tipoEvento
  const huella = huellaEvento(
    {
      sifNif: SIF_IDENTITY.nif,
      sifId: SIF_IDENTITY.idSistemaInformatico,
      idSistemaInformatico: SIF_IDENTITY.idSistemaInformatico,
      version: SIF_IDENTITY.version,
      numeroInstalacion: SIF_IDENTITY.numeroInstalacion,
      nifObligado: obligadoNif,
      tipoEvento,
      generadoEn,
    },
    huellaAnterior,
  )
  return { tag: tipoEvento, tone: toneDe(tipoEvento), descripcion: desc, huella, huellaAnterior: huellaAnterior ?? null }
}
