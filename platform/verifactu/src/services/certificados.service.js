import { withTenantTransaction } from '../lib/db.js'
import { parsePkcs12, metaResumen } from '../lib/pkcs12.js'
import * as repo from '../repositories/certificados.repository.js'
import { ReglaNegocioError } from './verifactu.service.js'

const tx = (scope, fn) =>
  withTenantTransaction(scope.appId, scope.tenantId, scope.subTenantId ?? null, fn)

// Lista de certificados del tenant (sólo metadatos; nunca material privado).
export function listCertificados(scope) {
  return tx(scope, (c) => repo.listCertificados(c))
}

export function getCertificado(scope, id) {
  return tx(scope, async (c) => {
    const cert = await repo.getCertificadoDisplay(c, id)
    if (!cert) throw new ReglaNegocioError('CERT_NO_ENCONTRADO', `certificado '${id}' no encontrado`)
    return cert
  })
}

// Sube un PKCS#12 (base64) + passphrase → valida, extrae metadatos reales y
// persiste el material CIFRADO. La passphrase y el .p12 nunca se devuelven.
export function subirCertificado(scope, input) {
  const der = Buffer.from(input.pkcs12Base64, 'base64')
  const meta = parsePkcs12(der, input.passphrase ?? '') // lanza CertificadoError (422) si es inválido
  return tx(scope, (c) => repo.insertCertificado(c, {
    ...scope,
    nombre: input.nombre ?? meta.cn ?? 'Certificado',
    uso: input.uso ?? 'firma',
    cn: meta.cn,
    emisor: meta.emisor,
    numeroSerie: meta.numeroSerie,
    caducaEn: meta.caducaEn,
    meta: metaResumen(meta),
    pkcs12: der,
    passphrase: input.passphrase ?? '',
  }))
}

// Renovación: sustituye el material y metadatos de un certificado existente sin
// cambiar su id (las referencias se mantienen).
export function renovarCertificado(scope, id, input) {
  const der = Buffer.from(input.pkcs12Base64, 'base64')
  const meta = parsePkcs12(der, input.passphrase ?? '')
  return tx(scope, async (c) => {
    const updated = await repo.replaceCertificado(c, id, {
      cn: meta.cn, emisor: meta.emisor, numeroSerie: meta.numeroSerie,
      caducaEn: meta.caducaEn, meta: metaResumen(meta), uso: input.uso ?? null,
      pkcs12: der, passphrase: input.passphrase ?? '',
    })
    if (!updated) throw new ReglaNegocioError('CERT_NO_ENCONTRADO', `certificado '${id}' no encontrado`)
    return updated
  })
}

export function eliminarCertificado(scope, id) {
  return tx(scope, async (c) => {
    const ok = await repo.deleteCertificado(c, id)
    if (!ok) throw new ReglaNegocioError('CERT_NO_ENCONTRADO', `certificado '${id}' no encontrado`)
    return { id, eliminado: true }
  })
}
