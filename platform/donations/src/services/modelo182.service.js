// Export del fichero modelo 182 (AEAT) — declaración informativa anual
// de donativos, donaciones y aportaciones recibidas.
//
// Formato: registros de 600 caracteres, codificación ISO-8859-1 (NO
// UTF-8). Cada línea termina en CRLF. Spec: Orden HAC/665/2004 y
// sucesivas; los códigos de tipo registro siguen siendo:
//   Tipo 1 (cabecera del declarante)   — 1 por fichero
//   Tipo 2 (registro de declarado)     — 1 por donante con NIF
//
// V1 implementa la spec más reciente publicada por AEAT; el módulo
// expone una función generadora que escribe el Buffer en ISO-8859-1
// listo para subir por la sede AEAT.
//
// NOTA legal: este export es asistencial. El usuario debe revisar
// con su asesor antes de presentar. No reemplaza la diligencia
// profesional contable.

import { withTenantTransaction } from '../lib/db.js'
import { ForbiddenError, AppError } from '@apphub/platform-sdk/errors'

const ADMIN_ROLES = new Set(['owner', 'admin', 'staff', 'super_admin'])
const RECORD_LEN = 600

function requireAdmin(identity) {
  if (!identity?.userId) throw new ForbiddenError()
  if (!ADMIN_ROLES.has(identity.role)) throw new ForbiddenError('Only admin/staff')
}

// Helpers de formateo: AEAT usa campos de ancho fijo, alineados.
// Texto = alinea izquierda + padding espacios.
// Numérico = alinea derecha + padding ceros.
function text(value, width) {
  const s = (value ?? '').toString().toUpperCase()
  return s.length >= width ? s.slice(0, width) : s + ' '.repeat(width - s.length)
}
function num(value, width) {
  const s = String(Math.round(Number(value ?? 0)))
  return s.length >= width ? s.slice(-width) : '0'.repeat(width - s.length) + s
}

// Convierte un Buffer UTF-8 a Buffer ISO-8859-1 (latin1). Los chars no
// representables se reemplazan por '?' — AEAT no admite UTF-8.
function toLatin1(str) {
  return Buffer.from(str, 'latin1')
}

// Resuelve la identidad del declarante (entidad sin fines lucrativos)
// desde platform_tenants.tenants.
async function resolveEntity(client, appId, tenantId) {
  const { rows } = await client.query(
    `SELECT legal_name, display_name, cif, address
       FROM platform_tenants.tenants WHERE id = $1 AND app_id = $2 LIMIT 1`,
    [tenantId, appId],
  )
  const t = rows[0]
  return {
    name:    (t?.legal_name || t?.display_name || '').toUpperCase(),
    nif:     (t?.cif || '').toUpperCase().replace(/\s/g, ''),
    address: (t?.address || '').toUpperCase(),
  }
}

// Agregado por NIF/year, sólo donaciones paid.
async function aggregateByNif(client, year) {
  const { rows } = await client.query(
    `SELECT donor_nif,
            MAX(donor_name)         AS donor_name,
            MAX(donor_address)      AS donor_address,
            MAX(donor_postal_code)  AS donor_postal_code,
            MAX(donor_country)      AS donor_country,
            SUM(amount_cents)::bigint AS total_cents,
            COUNT(*)                AS count_donations
       FROM platform_donations.donations
      WHERE donor_nif IS NOT NULL
        AND status = 'paid'
        AND EXTRACT(YEAR FROM paid_at) = $1
      GROUP BY donor_nif
      ORDER BY donor_nif`,
    [year],
  )
  return rows
}

// Construye un registro tipo 1 (declarante) — 600 chars.
// Posiciones aproximadas de la spec actual modelo 182:
//   1     '1'                    (tipo registro)
//   2-4   '182'                  (modelo)
//   5-8   ejercicio (YYYY)
//   9-17  NIF declarante (9 chars; alfanumérico para CIF)
//   18-57 razón social (40 chars)
//   58    'T'                    (tipo de presentación: T= telemática)
//   59-67 NIF presentador (= declarante para autopresentación)
//   68-76 teléfono (9 chars)
//   77-115 nombre persona de contacto (39 chars)
//   116-122 número justificante presentación (placeholder: ceros)
//   123-135 sigue formato AEAT: ceros y espacios
//   ... totales:
//   123-128 total registros declarados (numérico, 6 chars)
//   129-141 importe total donativos (numérico, 13 chars, en céntimos)
//   142-600 (en blanco)
function buildHeader({ year, entity, count, totalCents, contactPhone, contactName }) {
  let r = ''
  r += '1'                                  //  1
  r += '182'                                //  2-4
  r += num(year, 4)                          //  5-8
  r += text(entity.nif, 9)                   //  9-17
  r += text(entity.name, 40)                 // 18-57
  r += 'T'                                   // 58
  r += text(entity.nif, 9)                   // 59-67  (auto-presenta)
  r += text(contactPhone ?? '', 9)           // 68-76
  r += text(contactName ?? entity.name, 39)  // 77-115
  r += num(0, 13)                            // 116-128: justificante anterior + totales (placeholder)
  r += num(count, 9)                         // 129-137: número de declarados (numérico 9)
  r += num(totalCents, 15)                   // 138-152: total importe (céntimos, 15 chars)
  // padding hasta 600
  r += ' '.repeat(RECORD_LEN - r.length)
  return r
}

// Registro tipo 2 (declarado) — 600 chars.
//   1     '2'
//   2-4   '182'
//   5-8   ejercicio
//   9-17  NIF declarante
//   18-26 NIF declarado (donante)
//   27-35 NIF representante / cero
//   36-75 apellidos y nombre / razón social (40 chars)
//   76    código provincia (2)         — placeholder '00'
//   77-78 código país (2) — 'ES' si ES
//   79-89 importe donativo en céntimos (13 chars)
//   90    tipo de donativo: 'A' donativo dinerario
//   91    deducción autonómica: 'N' (no aplica por defecto)
//   92    revocación 'N'
//   93-96 ejercicio en que se efectuó la revocación: ceros
//   97-109 importe revocado: ceros
//   110   donativo en especie 'N'
//   111-600 padding
function buildDetail({ year, entity, donor }) {
  let r = ''
  r += '2'
  r += '182'
  r += num(year, 4)
  r += text(entity.nif, 9)
  r += text(donor.donor_nif, 9)
  r += '0'.repeat(9)                                              // sin representante
  r += text(donor.donor_name ?? '', 40)
  r += '00'                                                       // provincia (placeholder)
  r += text(donor.donor_country ?? 'ES', 2)
  r += num(donor.total_cents, 13)
  r += 'A'                                                        // dinerario
  r += 'N'                                                        // sin deducción autonómica
  r += 'N'                                                        // sin revocación
  r += '0'.repeat(4)
  r += '0'.repeat(13)
  r += 'N'                                                        // no en especie
  r += ' '.repeat(RECORD_LEN - r.length)
  return r
}

export async function exportModelo182(identity, { year, contactPhone, contactName }) {
  requireAdmin(identity)
  if (!Number.isInteger(year)) throw new AppError('VALIDATION_ERROR', 'year debe ser entero', 422)

  return withTenantTransaction(identity.appId, identity.tenantId, identity.subTenantId ?? null, async (c) => {
    const entity = await resolveEntity(c, identity.appId, identity.tenantId)
    if (!entity.nif) throw new AppError('TENANT_MISSING_CIF', 'El tenant no tiene CIF configurado', 412)

    const donors = await aggregateByNif(c, year)
    const totalCents = donors.reduce((s, d) => s + Number(d.total_cents), 0)

    const lines = []
    lines.push(buildHeader({ year, entity, count: donors.length, totalCents, contactPhone, contactName }))
    for (const d of donors) lines.push(buildDetail({ year, entity, donor: d }))

    const content = lines.join('\r\n') + '\r\n'
    return {
      filename: `MODELO_182_${year}_${entity.nif}.txt`,
      buffer:   toLatin1(content),
      year,
      count:    donors.length,
      totalCents,
    }
  })
}
