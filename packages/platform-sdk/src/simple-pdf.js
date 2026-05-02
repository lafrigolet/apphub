// Minimal hand-rolled text-only PDF generator. Used by intake-forms (filled
// questionnaire export) and practitioner-payouts (period statement) so we
// don't have to pull a PDF dep into the monolith.
//
// What's supported:
//   - One-page or multi-page output.
//   - Built-in Helvetica (PDF base 14 font — no embedding, no metrics file).
//   - Line breaks, page breaks (~55 lines per A4 page at 12pt).
//   - ASCII / Latin-1 characters. Multi-byte UTF-8 is replaced with '?'.
//
// What it deliberately doesn't do:
//   - Rich layout, tables, images, hyperlinks, font sizes, colour.
//
// If we ever need any of the above we should bring in pdf-lib; until then
// this keeps platform-sdk dep-free.

import { Buffer } from 'node:buffer'

const PAGE_WIDTH      = 612         // letter (8.5 × 11 in @ 72dpi). Fine for A4 print too.
const PAGE_HEIGHT     = 792
const MARGIN_X        = 50
const MARGIN_Y        = 50
const LINE_HEIGHT     = 14
const FONT_SIZE       = 11
const TITLE_FONT_SIZE = 16
const LINES_PER_PAGE  = Math.floor((PAGE_HEIGHT - 2 * MARGIN_Y) / LINE_HEIGHT) - 4   // -4 for title + spacing
const MAX_CHARS_PER_LINE = 95

function pdfEscape(s) {
  // Replace non-Latin-1 with '?', escape PDF-special characters.
  return String(s ?? '')
    .replace(/[^\x20-\x7e\xa0-\xff]/g, '?')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
}

function wrap(line) {
  const out = []
  let cursor = String(line ?? '')
  while (cursor.length > MAX_CHARS_PER_LINE) {
    let breakAt = cursor.lastIndexOf(' ', MAX_CHARS_PER_LINE)
    if (breakAt < 40) breakAt = MAX_CHARS_PER_LINE
    out.push(cursor.slice(0, breakAt))
    cursor = cursor.slice(breakAt).trimStart()
  }
  out.push(cursor)
  return out
}

function paginate(lines) {
  const pages = []
  let current = []
  for (const raw of lines) {
    for (const piece of wrap(raw)) {
      current.push(piece)
      if (current.length >= LINES_PER_PAGE) {
        pages.push(current)
        current = []
      }
    }
  }
  if (current.length || pages.length === 0) pages.push(current)
  return pages
}

function buildPageStream(title, isFirstPage, lines) {
  const ops = []
  ops.push('BT')                                                      // begin text
  if (isFirstPage && title) {
    ops.push(`/F1 ${TITLE_FONT_SIZE} Tf`)
    ops.push(`${MARGIN_X} ${PAGE_HEIGHT - MARGIN_Y} Td`)
    ops.push(`(${pdfEscape(title)}) Tj`)
    ops.push(`/F1 ${FONT_SIZE} Tf`)
    ops.push(`0 ${-(LINE_HEIGHT * 2)} Td`)
  } else {
    ops.push(`/F1 ${FONT_SIZE} Tf`)
    ops.push(`${MARGIN_X} ${PAGE_HEIGHT - MARGIN_Y} Td`)
  }
  for (const ln of lines) {
    ops.push(`(${pdfEscape(ln)}) Tj`)
    ops.push(`0 ${-LINE_HEIGHT} Td`)
  }
  ops.push('ET')
  return ops.join('\n')
}

// Build the PDF as a Buffer. Spec: PDF 1.4, all objects in a flat list,
// xref + trailer at the end.
export function createTextPdf({ title, lines }) {
  const pages = paginate(lines ?? [])

  const objects = []                  // { id, body }  body is a string
  const enqueue = (body) => { const id = objects.length + 1; objects.push({ id, body }); return id }

  // 1. Catalog → 2. Pages tree → page objects + content streams + font.
  // We allocate ids up-front to wire references.
  const catalogId  = 1
  const pagesTreeId = 2
  const fontId     = 3
  let nextId       = 4
  const pageIds       = pages.map(() => nextId++)
  const contentIds    = pages.map(() => nextId++)

  objects.push({ id: catalogId,   body: `<< /Type /Catalog /Pages ${pagesTreeId} 0 R >>` })
  objects.push({
    id: pagesTreeId,
    body: `<< /Type /Pages /Count ${pages.length} /Kids [${pageIds.map((p) => `${p} 0 R`).join(' ')}] >>`,
  })
  objects.push({ id: fontId,      body: `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>` })

  pages.forEach((pageLines, i) => {
    const stream = buildPageStream(title, i === 0, pageLines)
    objects.push({
      id: pageIds[i],
      body:
        `<< /Type /Page /Parent ${pagesTreeId} 0 R ` +
        `/MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
        `/Resources << /Font << /F1 ${fontId} 0 R >> >> ` +
        `/Contents ${contentIds[i]} 0 R >>`,
    })
    objects.push({
      id: contentIds[i],
      body: `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
    })
  })

  objects.sort((a, b) => a.id - b.id)

  let body = '%PDF-1.4\n%âãÏÓ\n'
  const offsets = ['0000000000 65535 f ']
  for (const o of objects) {
    offsets.push(String(Buffer.byteLength(body, 'latin1')).padStart(10, '0') + ' 00000 n ')
    body += `${o.id} 0 obj\n${o.body}\nendobj\n`
  }
  const xrefOffset = Buffer.byteLength(body, 'latin1')
  body += `xref\n0 ${objects.length + 1}\n${offsets.join('\n')}\n`
  body += `trailer << /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\n`
  body += `startxref\n${xrefOffset}\n%%EOF`

  return Buffer.from(body, 'latin1')
}
