import { describe, it, expect } from 'vitest'
import { normalizeNif, isValidNif, nifType, provinceCodeFromPostalCode } from '../lib/nif.js'

describe('normalizeNif', () => {
  it('quita espacios, puntos, guiones y pasa a mayúsculas', () => {
    expect(normalizeNif(' 12.345.678-z ')).toBe('12345678Z')
  })
  it('devuelve null para vacío/nulo', () => {
    expect(normalizeNif(null)).toBeNull()
    expect(normalizeNif('')).toBeNull()
    expect(normalizeNif('   ')).toBeNull()
  })
})

describe('isValidNif — DNI', () => {
  it('acepta DNI válido', () => {
    expect(isValidNif('12345678Z')).toBe(true)
  })
  it('rechaza DNI con letra de control incorrecta', () => {
    expect(isValidNif('12345678A')).toBe(false)
  })
})

describe('isValidNif — NIE', () => {
  it('acepta NIE válido (X/Y/Z)', () => {
    expect(isValidNif('X1234567L')).toBe(true)
    expect(isValidNif('Y0000000Z')).toBe(true)
  })
  it('rechaza NIE con control incorrecto', () => {
    expect(isValidNif('X1234567X')).toBe(false)
  })
})

describe('isValidNif — CIF', () => {
  it('acepta CIF válido con dígito de control', () => {
    expect(isValidNif('B12345674')).toBe(true)
  })
  it('acepta CIF de organización con letra de control (P/Q/S/...)', () => {
    // Q2826000H — NIF típico de organismo público (letra de control).
    expect(isValidNif('Q2826000H')).toBe(true)
  })
  it('rechaza CIF con control incorrecto', () => {
    expect(isValidNif('B12345670')).toBe(false)
  })
})

describe('isValidNif — bordes', () => {
  it('rechaza nulo/vacío', () => {
    expect(isValidNif(null)).toBe(false)
    expect(isValidNif('')).toBe(false)
  })
  it('rechaza basura', () => {
    expect(isValidNif('NOTANIF')).toBe(false)
  })
  it('normaliza antes de validar (acepta con guiones)', () => {
    expect(isValidNif('12345678-Z')).toBe(true)
  })
})

describe('nifType', () => {
  it('clasifica dni/nie/cif/null', () => {
    expect(nifType('12345678Z')).toBe('dni')
    expect(nifType('X1234567L')).toBe('nie')
    expect(nifType('B12345674')).toBe('cif')
    expect(nifType('basura')).toBeNull()
  })
})

describe('provinceCodeFromPostalCode', () => {
  it('extrae los 2 primeros dígitos del CP', () => {
    expect(provinceCodeFromPostalCode('28013')).toBe('28')
    expect(provinceCodeFromPostalCode('07001')).toBe('07')
  })
  it("devuelve '00' si CP ausente o fuera de rango 01..52", () => {
    expect(provinceCodeFromPostalCode(null)).toBe('00')
    expect(provinceCodeFromPostalCode('99999')).toBe('00')
    expect(provinceCodeFromPostalCode('00123')).toBe('00')
    expect(provinceCodeFromPostalCode('X')).toBe('00')
  })
})
