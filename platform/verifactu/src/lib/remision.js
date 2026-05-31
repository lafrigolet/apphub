import https from 'node:https'
import { resolverEndpoint, parseRespuesta } from './soap-envelope.js'

// Cliente de remisión SOAP a la AEAT (mTLS).
//
// ⚠️ SCAFFOLD GATED — sin un PKCS#12 (certificado cualificado) configurado, la
// remisión es INERTE: `remitir` lanza un error claro. Con un cert real el
// plumbing está listo: agente HTTPS con cert de cliente (mTLS) + POST del
// envelope + parseo de la respuesta. El envío real y la cola/reintentos/DLQ son
// TODO D6-D9. NOTA: la cobertura de este fichero se hace por integración (M11),
// no por unit (I/O de red).

// Transport por defecto: POST HTTPS con mTLS (cert de cliente vía pfx).
function httpsSoapPost(url, body, { pfx, passphrase }) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const req = https.request(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method: 'POST',
        headers: { 'Content-Type': 'text/xml; charset=utf-8', 'Content-Length': Buffer.byteLength(body) },
        agent: new https.Agent({ pfx, passphrase, keepAlive: true, minVersion: 'TLSv1.2' }),
      },
      (res) => {
        let data = ''
        res.on('data', (c) => { data += c })
        res.on('end', () => resolve({ status: res.statusCode, body: data }))
      },
    )
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

// Remite un envelope SOAP. `pfx` (Buffer PKCS#12) + `passphrase` son
// obligatorios — sin ellos lanza (gated). `transport` es inyectable para tests.
export async function remitir(
  { envelopeXml, pfx, passphrase, entorno = 'test', sello = false },
  { transport = httpsSoapPost } = {},
) {
  if (!pfx) {
    throw new Error('certificado no configurado: la remisión a la AEAT requiere un PKCS#12 (mTLS)')
  }
  if (!envelopeXml) throw new Error('envelopeXml requerido')

  const endpoint = resolverEndpoint({ entorno, sello })
  const res = await transport(endpoint, envelopeXml, { pfx, passphrase })
  return { endpoint, status: res.status, respuesta: parseRespuesta(res.body) }
}
