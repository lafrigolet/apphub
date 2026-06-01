// Certificate template — función pura que arma el árbol React.createElement
// del PDF (Ley 49/2002). Stubeamos @react-pdf/renderer para no arrastrar el
// renderer real; sólo verificamos que la función construye el árbol cubriendo
// las ramas opcionales (entity.address, donor.address, mapeo de donaciones).
import { describe, it, expect, vi } from 'vitest'

// Componentes stub: devuelven un objeto inspeccionable con sus children.
vi.mock('@react-pdf/renderer', () => {
  const make = (name) => (props, ...children) => ({ name, props, children })
  return {
    Document: make('Document'),
    Page:     make('Page'),
    Text:     make('Text'),
    View:     make('View'),
    StyleSheet: { create: (s) => s },
  }
})

import { Certificate } from '../templates/Certificate.js'

const base = {
  entity: { name: 'Fundación X', nif: 'G-1', address: 'Calle 1' },
  donor:  { name: 'Juan', nif: 'X1', address: 'Av 2', postalCode: '28001', country: 'ES' },
  fiscalYear: 2025,
  donations: [
    { paidAt: new Date('2025-03-01'), causeName: 'Becas', amountCents: 10000 },
    { paidAt: new Date('2025-06-01'), causeName: null, amountCents: 2500 },
  ],
  totalCents: 12500,
  generatedAt: new Date('2026-01-15'),
  certificateId: 'cert-1',
}

// Recorre el árbol React buscando todo string que aparezca como children,
// independientemente de la forma del nodo (elemento React o stub).
function flattenText(node, acc = []) {
  if (node == null || node === false) return acc
  if (typeof node === 'string') { acc.push(node); return acc }
  if (Array.isArray(node)) { node.forEach((n) => flattenText(n, acc)); return acc }
  if (typeof node === 'object') {
    // Elemento React real: { type, props: { children } }
    if (node.props) flattenText(node.props.children, acc)
    // Stub: { name, children }
    if (node.children) flattenText(node.children, acc)
  }
  return acc
}

describe('Certificate', () => {
  it('renderiza con entity.address + donor.address presentes', () => {
    const tree = Certificate(base)
    expect(tree).toBeTruthy()
    const texts = flattenText(tree).join(' | ')
    expect(texts).toMatch(/Certificado de donativos 2025/)
    expect(texts).toMatch(/cert-1/)
    expect(texts).toMatch(/Becas/)
    expect(texts).toMatch(/Fondo general/)   // causeName null → fallback
    expect(texts).toMatch(/Total donado en 2025/)
  })

  it('entity.address y donor.address ausentes → ramas null sin crash', () => {
    const tree = Certificate({
      ...base,
      entity: { name: 'X', nif: 'G-1', address: null },
      donor:  { name: null, nif: 'X1', address: null },
    })
    const texts = flattenText(tree).join(' | ')
    // donor.name null → '—'
    expect(texts).toMatch(/—/)
    expect(tree).toBeTruthy()
  })

  it('lista de donaciones vacía → tabla sin filas pero total presente', () => {
    const tree = Certificate({ ...base, donations: [], totalCents: 0 })
    const texts = flattenText(tree).join(' | ')
    expect(texts).toMatch(/Total donado en 2025/)
  })

  it('importes null/undefined → eur usa rama `cents ?? 0` (0,00 €)', () => {
    const tree = Certificate({
      ...base,
      donations: [{ paidAt: new Date('2025-03-01'), causeName: 'Becas', amountCents: null }],
      totalCents: undefined,
    })
    const texts = flattenText(tree).join(' | ')
    // 0/100 formateado en es-ES como moneda EUR contiene "0,00"
    expect(texts).toMatch(/0,00/)
  })
})
