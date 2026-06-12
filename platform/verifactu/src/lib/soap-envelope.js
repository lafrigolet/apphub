import { create } from 'xmlbuilder2'
import { XMLParser } from 'fast-xml-parser'
import { SIF_IDENTITY } from './sif.js'

// Envelope SOAP de remisión (RegFactuSistemaFacturacion) + parseo de la respuesta.
//
// Namespaces OFICIALES tomados de los XSD de la AEAT (descargados en
// schemas/aeat/): SuministroLR.xsd (sfLR: el sobre RegFactu + RegistroFactura) y
// SuministroInformacion.xsd (sf: Cabecera, RegistroAlta/Anulacion y tipos
// comunes). elementFormDefault="qualified" → todos los hijos van con prefijo.
//
// Cobertura: se construyen los campos principales del RegistroAlta (IDFactura,
// emisor, tipo, importes, Desglose de una línea sintetizado desde importe/cuota,
// Encadenamiento, SistemaInformatico, huella). El desglose multi-tipo por líneas
// reales y los campos opcionales (rectificativas, subsanación) se añaden cuando
// el documento de origen los aporte. La firma XAdES (lib/xades.js) es opcional en
// modalidad Veri*Factu.

export const NS = {
  soapenv: 'http://schemas.xmlsoap.org/soap/envelope/',
  sfLR: 'https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroLR.xsd',
  sf: 'https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd',
}

export const MAX_REGISTROS = 1000 // RegistroFactura maxOccurs=1000 (SuministroLR.xsd)

// Endpoints del servicio web SistemaFacturacion. www10/prewww10 = certificado de
// sello (empresa); www1/prewww1 = certificado de persona/representante.
export const ENDPOINTS = {
  test:       'https://prewww1.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP',
  test_sello: 'https://prewww10.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP',
  prod:       'https://www1.agenciatributaria.gob.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP',
  prod_sello: 'https://www10.agenciatributaria.gob.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP',
}

export function resolverEndpoint({ entorno = 'test', sello = false } = {}) {
  const clave = sello && ENDPOINTS[`${entorno}_sello`] ? `${entorno}_sello` : entorno
  return ENDPOINTS[clave] ?? ENDPOINTS.test
}

const num = (v) => (v == null ? null : Number(v).toFixed(2))

// SistemaInformatico (productor del SIF) — bloque común a cada registro.
function sistemaInformatico() {
  return {
    'sf:NombreRazon': SIF_IDENTITY.nombre,
    'sf:NIF': SIF_IDENTITY.nif,
    'sf:NombreSistemaInformatico': SIF_IDENTITY.nombreSistemaInformatico,
    'sf:IdSistemaInformatico': SIF_IDENTITY.idSistemaInformatico,
    'sf:Version': SIF_IDENTITY.version,
    'sf:NumeroInstalacion': SIF_IDENTITY.numeroInstalacion,
  }
}

// Encadenamiento: primer registro de la cadena ('S') o referencia al anterior.
function encadenamiento(r) {
  if (!r.huellaAnterior) return { 'sf:PrimerRegistro': 'S' }
  return {
    'sf:RegistroAnterior': {
      'sf:IDEmisorFactura': r.idEmisor ?? '',
      'sf:NumSerieFactura': r.numSerieAnterior ?? '',
      'sf:FechaExpedicionFactura': r.fechaAnterior ?? '',
      'sf:Huella': r.huellaAnterior,
    },
  }
}

// Desglose mínimo de una línea sintetizado desde importe/cuota (tipo general).
function desgloseUnaLinea(r) {
  const cuota = num(r.cuotaTotal)
  const total = num(r.importeTotal)
  const base = cuota != null && total != null ? (Number(total) - Number(cuota)).toFixed(2) : total
  const tipo = base && Number(base) > 0 && cuota != null
    ? ((Number(cuota) / Number(base)) * 100).toFixed(2)
    : '21.00'
  return {
    'sf:DetalleDesglose': {
      'sf:ClaveRegimen': '01',          // operación de régimen general
      'sf:CalificacionOperacion': 'S1', // sujeta y no exenta
      'sf:TipoImpositivo': tipo,
      'sf:BaseImponibleOimporteNoSujeto': base,
      'sf:CuotaRepercutida': cuota ?? '0.00',
    },
  }
}

// Construye un RegistroAlta (objeto para xmlbuilder2, prefijo sf:).
export function construirRegistroAlta(r) {
  return {
    'sf:IDVersion': '1.0',
    'sf:IDFactura': {
      'sf:IDEmisorFactura': r.idEmisor ?? '',
      'sf:NumSerieFactura': r.numSerie ?? '',
      'sf:FechaExpedicionFactura': r.fechaExpedicion ?? '',
    },
    'sf:NombreRazonEmisor': r.nombreEmisor ?? r.idEmisor ?? '',
    'sf:TipoFactura': r.tipoFactura ?? 'F1',
    'sf:DescripcionOperacion': r.descripcion ?? 'Venta',
    'sf:Desglose': desgloseUnaLinea(r),
    'sf:CuotaTotal': num(r.cuotaTotal) ?? '0.00',
    'sf:ImporteTotal': num(r.importeTotal) ?? '0.00',
    'sf:Encadenamiento': encadenamiento(r),
    'sf:SistemaInformatico': sistemaInformatico(),
    'sf:FechaHoraHusoGenRegistro': r.generadoEn ?? '',
    'sf:TipoHuella': '01', // 01 = SHA-256
    'sf:Huella': r.huella ?? '',
  }
}

// Construye un RegistroAnulacion (campos propios: factura anulada + encadenamiento).
export function construirRegistroAnulacion(r) {
  return {
    'sf:IDVersion': '1.0',
    'sf:IDFactura': {
      'sf:IDEmisorFacturaAnulada': r.idEmisor ?? '',
      'sf:NumSerieFacturaAnulada': r.numSerie ?? '',
      'sf:FechaExpedicionFacturaAnulada': r.fechaExpedicion ?? '',
    },
    'sf:Encadenamiento': encadenamiento(r),
    'sf:SistemaInformatico': sistemaInformatico(),
    'sf:FechaHoraHusoGenRegistro': r.generadoEn ?? '',
    'sf:TipoHuella': '01',
    'sf:Huella': r.huella ?? '',
  }
}

// Renderiza un RegistroAlta suelto (con su namespace) a XML string — lo consume
// la firma XAdES (lib/xades.js), que opera sobre un fragmento autónomo.
export function registroAltaXml(r) {
  const obj = { 'sf:RegistroAlta': { '@xmlns:sf': NS.sf, ...construirRegistroAlta(r) } }
  return create({ version: '1.0', encoding: 'UTF-8' }, obj).end({ prettyPrint: false })
}

// Construye el envelope SOAP completo de RegFactuSistemaFacturacion.
export function construirEnvelope({ obligado, representante, registros = [] }) {
  if (!obligado?.nif) throw new Error('Cabecera: ObligadoEmision.NIF requerido')
  if (registros.length === 0) throw new Error('Sin registros para remitir')
  if (registros.length > MAX_REGISTROS) {
    throw new Error(`Máximo ${MAX_REGISTROS} registros por remisión (recibidos ${registros.length})`)
  }

  const cabecera = {
    'sf:ObligadoEmision': { 'sf:NombreRazon': obligado.nombre ?? '', 'sf:NIF': obligado.nif },
  }
  if (representante?.nif) {
    cabecera['sf:Representante'] = { 'sf:NombreRazon': representante.nombre ?? '', 'sf:NIF': representante.nif }
  }

  const registroFactura = registros.map((r) => (
    r.tipo === 'anulacion'
      ? { 'sf:RegistroAnulacion': construirRegistroAnulacion(r) }
      : { 'sf:RegistroAlta': construirRegistroAlta(r) }
  ))

  const obj = {
    'soapenv:Envelope': {
      '@xmlns:soapenv': NS.soapenv,
      '@xmlns:sfLR': NS.sfLR,
      '@xmlns:sf': NS.sf,
      'soapenv:Body': {
        'sfLR:RegFactuSistemaFacturacion': {
          'sfLR:Cabecera': cabecera,
          'sfLR:RegistroFactura': registroFactura,
        },
      },
    },
  }
  return create({ version: '1.0', encoding: 'UTF-8' }, obj).end({ prettyPrint: false })
}

const parser = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true })

// Normaliza la respuesta de la AEAT (RespuestaSuministro.xsd) a un objeto estable.
export function parseRespuesta(xml) {
  const j = parser.parse(xml)
  const body = j?.Envelope?.Body ?? j?.Body ?? j
  const resp = body?.RespuestaRegFactuSistemaFacturacion ?? body?.RespuestaSuministro ?? body?.Respuesta ?? {}

  const lineasRaw = resp.RespuestaLinea ?? []
  const lineas = (Array.isArray(lineasRaw) ? lineasRaw : [lineasRaw]).filter(Boolean).map((l) => ({
    numSerie: l?.IDFactura?.NumSerieFactura ?? l?.NumSerieFactura ?? null,
    estado: l?.EstadoRegistro ?? null,
    codigoError: l?.CodigoErrorRegistro ?? null,
    descripcion: l?.DescripcionErrorRegistro ?? null,
    csv: l?.CSV ?? null,
  }))

  return {
    estadoEnvio: resp.EstadoEnvio ?? null,
    csv: resp.CSV ?? null,
    tiempoEsperaEnvio: resp.TiempoEsperaEnvio ?? null,
    lineas,
  }
}
