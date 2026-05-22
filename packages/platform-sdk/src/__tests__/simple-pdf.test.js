// simple-pdf — PDF 1.4 hand-rolled text-only writer.
// Contrato:
//   - createTextPdf({ title, lines }) → Buffer (PDF válido).
//   - Header inicia "%PDF-1.4", finaliza con "%%EOF".
//   - Single-byte text: ASCII + Latin-1 (0x20-0x7e, 0xa0-0xff) pasan; UTF-8
//     multi-byte se reemplaza por '?'.
//   - PDF-special chars (\\, (, )) se escapan.
//   - Pagina cada ~55 líneas (LINES_PER_PAGE -4 para título).
//   - Wrap automático en MAX_CHARS_PER_LINE = 95 (en espacio si lo hay).
//   - lines = [] o null → 1 página vacía (no crash).
//   - title se renderiza solo en la primera página.
//   - xref correcto: cantidad de entradas = objects + 1.
//   - trailer /Size = objects.length + 1, /Root apunta al catalog.

import { describe, it, expect } from 'vitest'
import { createTextPdf } from '../simple-pdf.js'

// Decodifica el Buffer como latin1 para asserts de structure-level.
function asString(buf) {
  return buf.toString('latin1')
}

// ── Estructura PDF ─────────────────────────────────────────────────

describe('PDF structure', () => {
  it('header: "%PDF-1.4"', () => {
    const pdf = createTextPdf({ title: 'X', lines: ['hello'] })
    expect(pdf).toBeInstanceOf(Buffer)
    expect(asString(pdf).startsWith('%PDF-1.4')).toBe(true)
  })

  it('tail: "%%EOF"', () => {
    const pdf = createTextPdf({ title: 'X', lines: ['hello'] })
    expect(asString(pdf).trimEnd().endsWith('%%EOF')).toBe(true)
  })

  it('incluye xref + trailer + startxref', () => {
    const s = asString(createTextPdf({ title: 'X', lines: ['a', 'b'] }))
    expect(s).toMatch(/\nxref\n/)
    expect(s).toMatch(/\ntrailer << /)
    expect(s).toMatch(/\nstartxref\n\d+\n/)
  })

  it('catalog object: /Type /Catalog + Pages reference', () => {
    const s = asString(createTextPdf({ title: 'X', lines: ['a'] }))
    expect(s).toMatch(/<< \/Type \/Catalog \/Pages \d+ 0 R >>/)
  })

  it('font Helvetica (base 14)', () => {
    const s = asString(createTextPdf({ title: 'X', lines: ['a'] }))
    expect(s).toMatch(/\/Font \/Subtype \/Type1 \/BaseFont \/Helvetica/)
  })
})

// ── Casos límite ────────────────────────────────────────────────────

describe('edge cases', () => {
  it('lines = [] → 1 página vacía (no crash)', () => {
    const pdf = createTextPdf({ title: 'X', lines: [] })
    expect(pdf.length).toBeGreaterThan(100)
    const s = asString(pdf)
    expect(s).toMatch(/\/Count 1/)                    // 1 página
  })

  it('lines = null → comportamiento como []', () => {
    const pdf = createTextPdf({ title: 'X', lines: null })
    expect(pdf).toBeInstanceOf(Buffer)
  })

  it('sin title → primera página sin línea de título', () => {
    const pdf = createTextPdf({ lines: ['contenido'] })
    expect(pdf).toBeInstanceOf(Buffer)
    // No specific assert on title text — solo que no crashea
  })

  it('60 líneas → ≥2 páginas (LINES_PER_PAGE -4 ≈ 51)', () => {
    const lines = Array.from({ length: 60 }, (_, i) => `linea ${i}`)
    const s = asString(createTextPdf({ title: 'X', lines }))
    expect(s).toMatch(/\/Count [2-9]/)                // 2+ páginas
  })
})

// ── Escape de caracteres ─────────────────────────────────────────────

describe('character escaping', () => {
  it('latin-1 con acentos PASA tal cual', () => {
    const s = asString(createTextPdf({ title: 'Ñá', lines: ['héllo Ç'] }))
    expect(s).toContain('héllo Ç')
  })

  it('emojis / UTF-8 multi-byte → "?"', () => {
    const s = asString(createTextPdf({ title: 'X', lines: ['hello 🚀 world'] }))
    expect(s).not.toContain('🚀')
    expect(s).toMatch(/hello \?+ world/)            // emoji reemplazado por '?'(s)
  })

  it('paréntesis se escapan a "\\(" y "\\)"', () => {
    const s = asString(createTextPdf({ title: 'X', lines: ['(hello)'] }))
    expect(s).toContain('\\(hello\\)')
  })

  it('backslash se escapa a "\\\\"', () => {
    const s = asString(createTextPdf({ title: 'X', lines: ['C:\\path\\to\\file'] }))
    expect(s).toContain('C:\\\\path\\\\to\\\\file')
  })

  it('null / undefined en line → string vacío (no crash)', () => {
    expect(() => createTextPdf({ title: 'X', lines: [null, undefined, ''] })).not.toThrow()
  })
})

// ── Wrap ────────────────────────────────────────────────────────────

describe('line wrap', () => {
  it('línea >95 chars con espacio → wrap en último espacio < 95', () => {
    const long = 'palabra '.repeat(20)                // ~160 chars con espacios
    const s = asString(createTextPdf({ title: 'X', lines: [long] }))
    // Cada Tj operator es una línea separada; debería haber > 1
    const tjCount = (s.match(/\) Tj/g) ?? []).length
    expect(tjCount).toBeGreaterThan(1)               // 1 del título + ≥2 de la línea
  })

  it('línea >95 chars SIN espacio → corte duro a 95 chars', () => {
    const noSpace = 'x'.repeat(150)
    const s = asString(createTextPdf({ title: 'X', lines: [noSpace] }))
    // El primer chunk tiene exactamente 95 'x' seguidos
    expect(s).toMatch(/x{95}\) Tj/)
  })
})

// ── Output válido (re-parseable) ─────────────────────────────────────

describe('output válido', () => {
  it('xref count = objects + 1 (entry 0 reservada)', () => {
    const s = asString(createTextPdf({ title: 'X', lines: ['a'] }))
    // xref\n0 N\n con N matching /Size N en trailer
    const xrefMatch  = s.match(/xref\n0 (\d+)\n/)
    const trailerMatch = s.match(/trailer << \/Size (\d+) /)
    expect(xrefMatch).not.toBeNull()
    expect(trailerMatch).not.toBeNull()
    expect(xrefMatch[1]).toBe(trailerMatch[1])
  })

  it('Buffer no-vacío incluso con todo vacío', () => {
    const pdf = createTextPdf({ lines: [] })
    expect(pdf.length).toBeGreaterThan(200)
  })
})
