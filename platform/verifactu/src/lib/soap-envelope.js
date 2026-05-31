import { create } from 'xmlbuilder2'
import { XMLParser } from 'fast-xml-parser'

// Envelope SOAP de remisión + parseo de la respuesta de la AEAT.
//
// ⚠️ SCAFFOLD — la estructura (namespaces, nombres de elementos, contenido
// exacto de cada RegistroFactura) es ILUSTRATIVA y depende del WSDL + los XSD
// oficiales, que la AEAT no expone para descarga automatizada. VERIFICAR antes
// de enviar a producción (TODO D1/D4/E1). https://.../WSDL_de_los_servicios_web.html

export const MAX_REGISTROS = 1000 // máx registros por remisión (verificar límite oficial)

// Endpoints del servicio web VerifactuSOAP (verificar). www10/prewww10 =
// certificado de sello.
export const ENDPOINTS = {
  test: 'https://prewww1.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP',
  test_sello: 'https://prewww10.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP',
  prod: 'https://www1.agenciatributaria.gob.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP',
  prod_sello: 'https://www10.agenciatributaria.gob.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP',
}

export function resolverEndpoint({ entorno = 'test', sello = false } = {}) {
  const clave = sello && ENDPOINTS[`${entorno}_sello`] ? `${entorno}_sello` : entorno
  return ENDPOINTS[clave] ?? ENDPOINTS.test
}

const NS = {
  soapenv: 'http://schemas.xmlsoap.org/soap/envelope/',
  // Namespace ILUSTRATIVO — el real se toma del WSDL/XSD oficial.
  sf: 'https://www2.agenciatributaria.gob.es/static_files/.../SuministroLR.xsd',
}

// Construye el envelope SOAP de RegFactuSistemaFacturacion.
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

  const registroFactura = registros.map((r) => ({
    [`sf:Registro${r.tipo === 'anulacion' ? 'Anulacion' : 'Alta'}`]: {
      'sf:IDVersion': '1.0',
      'sf:NumSerieFactura': r.numSerie ?? '',
      'sf:Huella': r.huella ?? '',
    },
  }))

  const obj = {
    'soapenv:Envelope': {
      '@xmlns:soapenv': NS.soapenv,
      '@xmlns:sf': NS.sf,
      'soapenv:Body': {
        'sf:RegFactuSistemaFacturacion': {
          'sf:Cabecera': cabecera,
          'sf:RegistroFactura': registroFactura,
        },
      },
    },
  }
  return create({ version: '1.0', encoding: 'UTF-8' }, obj).end({ prettyPrint: false })
}

const parser = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true })

// Normaliza la respuesta de la AEAT a un objeto estable.
export function parseRespuesta(xml) {
  const j = parser.parse(xml)
  const body = j?.Envelope?.Body ?? j?.Body ?? j
  const resp = body?.RespuestaRegFactuSistemaFacturacion ?? body?.Respuesta ?? {}

  const lineasRaw = resp.RespuestaLinea ?? []
  const lineas = (Array.isArray(lineasRaw) ? lineasRaw : [lineasRaw]).filter(Boolean).map((l) => ({
    numSerie: l?.IDFactura?.NumSerieFactura ?? l?.NumSerieFactura ?? null,
    estado: l?.EstadoRegistro ?? null,
    codigoError: l?.CodigoErrorRegistro ?? null,
    descripcion: l?.DescripcionErrorRegistro ?? null,
  }))

  return {
    estadoEnvio: resp.EstadoEnvio ?? null,
    csv: resp.CSV ?? null,
    tiempoEsperaEnvio: resp.TiempoEsperaEnvio ?? null,
    lineas,
  }
}
