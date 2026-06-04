// Validación y normalización de NIF/NIE/CIF españoles, más utilidades
// fiscales asociadas (código de provincia AEAT a partir del código
// postal). Funciones puras — sin I/O — para reutilizar en checkout
// (normalización en ingesta), certificados y modelo 182 (validación
// previa al fichero AEAT).
//
// Referencias:
//   * DNI/NIE: letra de control sobre 23 (tabla TRWAGMYFPDXBNJZSQVHLCKE).
//   * CIF: dígito/letra de control según organización (algoritmo de
//     suma de pares + impares duplicados).
//   * Provincias AEAT: los dos primeros dígitos del código postal
//     identifican la provincia (01..52).

const CONTROL_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE'
const NIE_PREFIX_MAP = { X: '0', Y: '1', Z: '2' }
// Organizaciones cuyo dígito de control DEBE ser letra, las que DEBE ser
// número, y las que admiten ambos.
const CIF_LETTER_ORG = new Set(['K', 'P', 'Q', 'S', 'N', 'W'])
const CIF_NUMBER_ORG = new Set(['A', 'B', 'E', 'H'])
const CIF_FIRST_CHARS = 'ABCDEFGHJKLMNPQRSUVW'
const CIF_CONTROL_LETTERS = 'JABCDEFGHI'

/**
 * Normaliza un NIF: quita espacios/guiones/puntos y pasa a mayúsculas.
 * Devuelve null si la entrada es vacía/nula.
 */
export function normalizeNif(value) {
  if (value == null) return null
  const cleaned = String(value).replace(/[\s.-]/g, '').toUpperCase()
  return cleaned.length ? cleaned : null
}

function validateDni(nif) {
  // 8 dígitos + letra de control.
  if (!/^\d{8}[A-Z]$/.test(nif)) return false
  const number = parseInt(nif.slice(0, 8), 10)
  return CONTROL_LETTERS[number % 23] === nif[8]
}

function validateNie(nif) {
  // X/Y/Z + 7 dígitos + letra de control.
  if (!/^[XYZ]\d{7}[A-Z]$/.test(nif)) return false
  const number = parseInt(NIE_PREFIX_MAP[nif[0]] + nif.slice(1, 8), 10)
  return CONTROL_LETTERS[number % 23] === nif[8]
}

function validateCif(nif) {
  // Letra de organización + 7 dígitos + dígito/letra de control.
  if (!/^[ABCDEFGHJKLMNPQRSUVW]\d{7}[0-9A-J]$/.test(nif)) return false
  const org = nif[0]
  const digits = nif.slice(1, 8)
  const control = nif[8]

  let sumEven = 0
  let sumOdd = 0
  for (let i = 0; i < digits.length; i++) {
    const d = Number(digits[i])
    if (i % 2 === 0) {
      // posiciones impares (1,3,5,7 en 1-index): se duplican
      const doubled = d * 2
      sumOdd += doubled > 9 ? doubled - 9 : doubled
    } else {
      sumEven += d
    }
  }
  const total = sumEven + sumOdd
  const controlDigit = (10 - (total % 10)) % 10
  const controlLetter = CIF_CONTROL_LETTERS[controlDigit]

  if (CIF_LETTER_ORG.has(org)) return control === controlLetter
  if (CIF_NUMBER_ORG.has(org)) return control === String(controlDigit)
  // resto: admite dígito o letra
  return control === String(controlDigit) || control === controlLetter
}

/**
 * Devuelve true si el NIF (ya normalizado o no) es un DNI, NIE o CIF
 * español válido. No valida identificadores fiscales extranjeros.
 */
export function isValidNif(value) {
  const nif = normalizeNif(value)
  if (!nif) return false
  if (CIF_FIRST_CHARS.includes(nif[0]) && /\d/.test(nif[1] ?? '')) {
    // Puede ser CIF (empieza por letra de organización) o NIE (X/Y/Z).
    if (NIE_PREFIX_MAP[nif[0]] !== undefined) return validateNie(nif)
    return validateCif(nif)
  }
  if (NIE_PREFIX_MAP[nif[0]] !== undefined) return validateNie(nif)
  return validateDni(nif)
}

/**
 * Clasifica el tipo de identificador: 'dni' | 'nie' | 'cif' | null.
 */
export function nifType(value) {
  const nif = normalizeNif(value)
  if (!nif) return null
  if (validateDni(nif)) return 'dni'
  if (validateNie(nif)) return 'nie'
  if (validateCif(nif)) return 'cif'
  return null
}

/**
 * Deriva el código de provincia AEAT (2 chars, '01'..'52') a partir de
 * un código postal español. Devuelve '00' si no se puede determinar
 * (cp ausente o fuera de rango), que es el placeholder neutro de AEAT.
 */
export function provinceCodeFromPostalCode(postalCode) {
  if (postalCode == null) return '00'
  const digits = String(postalCode).replace(/\D/g, '')
  if (digits.length < 2) return '00'
  const prov = digits.slice(0, 2)
  const n = Number(prov)
  if (!Number.isInteger(n) || n < 1 || n > 52) return '00'
  return prov
}
