// Plantilla del certificado de donativos (Ley 49/2002).
// Sin JSX para evitar dependencia de transpilador en server-side —
// usamos React.createElement directamente. @react-pdf/renderer
// hace el resto.

import React from 'react'
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'

const styles = StyleSheet.create({
  page:    { padding: 48, fontSize: 11, fontFamily: 'Helvetica', color: '#0a0908', lineHeight: 1.45 },
  header:  { marginBottom: 24, borderBottom: '1pt solid #0a0908', paddingBottom: 12 },
  title:   { fontSize: 18, fontWeight: 700 },
  meta:    { fontSize: 9, color: '#6b6b6b', marginTop: 4 },
  section: { marginBottom: 18 },
  h2:      { fontSize: 12, fontWeight: 700, marginBottom: 6 },
  row:     { flexDirection: 'row', marginBottom: 3 },
  label:   { width: 130, fontWeight: 700 },
  value:   { flex: 1 },
  total:   { fontSize: 14, fontWeight: 700, marginTop: 8 },
  table:   { marginTop: 6, border: '1pt solid #c9c9c9' },
  trH:     { flexDirection: 'row', backgroundColor: '#f1eee8', padding: 6, borderBottom: '1pt solid #c9c9c9' },
  tr:      { flexDirection: 'row', padding: 6, borderBottom: '0.5pt solid #e3e3e3' },
  th:      { flex: 1, fontWeight: 700, fontSize: 10 },
  td:      { flex: 1, fontSize: 10 },
  tdRight: { flex: 1, fontSize: 10, textAlign: 'right' },
  legal:   { fontSize: 9, color: '#444', marginTop: 24, lineHeight: 1.4 },
  footer:  { fontSize: 8, color: '#888', textAlign: 'center', marginTop: 24 },
})

const e = React.createElement

function eur(cents) {
  return ((cents ?? 0) / 100).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })
}
function fmtDate(d) {
  return new Date(d).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function row(labelText, valueText) {
  return e(View, { style: styles.row },
    e(Text, { style: styles.label }, labelText),
    e(Text, { style: styles.value }, valueText),
  )
}

export function Certificate({ entity, donor, fiscalYear, donations, totalCents, generatedAt, certificateId, deduction }) {
  return e(Document, null,
    e(Page, { size: 'A4', style: styles.page },
      e(View, { style: styles.header },
        e(Text, { style: styles.title }, `Certificado de donativos ${fiscalYear}`),
        e(Text, { style: styles.meta }, `Emitido el ${fmtDate(generatedAt)} — código ${certificateId}`),
      ),
      e(View, { style: styles.section },
        e(Text, { style: styles.h2 }, 'Entidad declarante'),
        row('Denominación', entity.name),
        row('NIF', entity.nif),
        entity.address ? row('Domicilio fiscal', entity.address) : null,
      ),
      e(View, { style: styles.section },
        e(Text, { style: styles.h2 }, 'Donante'),
        row('Nombre', donor.name ?? '—'),
        row('NIF', donor.nif),
        donor.address
          ? row('Domicilio',
              [donor.address, donor.postalCode, donor.country].filter(Boolean).join(', '))
          : null,
      ),
      e(View, { style: styles.section },
        e(Text, { style: styles.h2 }, 'Donativos efectuados'),
        e(View, { style: styles.table },
          e(View, { style: styles.trH },
            e(Text, { style: styles.th }, 'Fecha'),
            e(Text, { style: styles.th }, 'Concepto'),
            e(Text, { style: [styles.th, { textAlign: 'right' }] }, 'Importe'),
          ),
          ...donations.map((d, i) =>
            e(View, { key: i, style: styles.tr },
              e(Text, { style: styles.td }, fmtDate(d.paidAt)),
              e(Text, { style: styles.td }, d.causeName ?? 'Fondo general'),
              e(Text, { style: styles.tdRight }, eur(d.amountCents)),
            ),
          ),
        ),
        e(Text, { style: styles.total }, `Total donado en ${fiscalYear}: ${eur(totalCents)}`),
      ),
      deduction
        ? e(View, { style: styles.section },
            e(Text, { style: styles.h2 }, 'Deducción estimada en IRPF'),
            row('Base de deducción', eur(deduction.baseCents)),
            row(`Primeros ${eur(deduction.firstBracketCents)} al 80 %`,
                eur(Math.round(deduction.firstBracketCents * 0.8))),
            deduction.excessCents > 0
              ? row(`Exceso al ${Math.round(deduction.excessRate * 100)} %`
                      + (deduction.loyal ? ' (fidelización)' : ''),
                    eur(Math.round(deduction.excessCents * deduction.excessRate)))
              : null,
            e(Text, { style: styles.total }, `Deducción estimada: ${eur(deduction.deductibleCents)}`),
          )
        : null,
      e(Text, { style: styles.legal },
        'Los donativos efectuados a esta entidad dan derecho a la deducción en ' +
        'la cuota íntegra del IRPF o del IS en los términos y con los límites ' +
        'establecidos en la Ley 49/2002, de 23 de diciembre, de régimen fiscal ' +
        'de las entidades sin fines lucrativos. Esta entidad ha sido declarada ' +
        'de utilidad pública conforme al artículo 3 de la citada Ley.',
      ),
      e(Text, { style: styles.footer },
        'Este certificado se emite electrónicamente y puede verificarse con el código indicado.',
      ),
    ),
  )
}
