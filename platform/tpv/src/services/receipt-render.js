// Render HTML del recibo desde el snapshot inmutable (receipts +
// receipt_lines). Regenerable e idempotente: nunca toca numeración ni
// totales. Pensado para imprimir desde el navegador del terminal
// (ancho de ticket 80mm) o adjuntar en email.

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]))
}

function money(cents, currency = 'EUR') {
  return `${(Number(cents) / 100).toFixed(2)} ${currency === 'EUR' ? '€' : currency}`
}

export function renderReceiptHtml(receipt, lines, { footer } = {}) {
  const isInvoice = receipt.type === 'invoice'
  const title = isInvoice ? 'FACTURA' : 'FACTURA SIMPLIFICADA'
  const issuer = receipt.issuer ?? {}
  const breakdown = Array.isArray(receipt.tax_breakdown) ? receipt.tax_breakdown : []

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>${esc(title)} ${esc(receipt.num_serie)}</title>
<style>
  body { font-family: 'Courier New', monospace; font-size: 12px; max-width: 320px; margin: 0 auto; padding: 12px; color: #111; }
  h1 { font-size: 14px; text-align: center; margin: 4px 0; }
  .center { text-align: center; }
  .issuer { text-align: center; margin-bottom: 8px; }
  .meta, .totals { width: 100%; margin: 8px 0; }
  table.lines { width: 100%; border-collapse: collapse; margin: 8px 0; }
  table.lines th, table.lines td { text-align: left; padding: 2px 0; }
  table.lines td.num, table.lines th.num { text-align: right; }
  .sep { border-top: 1px dashed #555; margin: 6px 0; }
  .total { font-weight: bold; font-size: 13px; }
  .qr { text-align: center; margin: 10px 0; }
  .qr img { width: 120px; height: 120px; }
  .verifactu { text-align: center; font-size: 10px; }
  .footer { text-align: center; font-size: 10px; margin-top: 10px; white-space: pre-wrap; }
</style>
</head>
<body>
  <div class="issuer">
    <strong>${esc(issuer.name)}</strong><br>
    NIF: ${esc(issuer.nif)}<br>
    ${issuer.address ? `${esc(issuer.address)}<br>` : ''}
    ${issuer.postalCode || issuer.city ? `${esc(issuer.postalCode ?? '')} ${esc(issuer.city ?? '')}<br>` : ''}
  </div>
  <h1>${esc(title)}</h1>
  <div class="center">
    Nº ${esc(receipt.num_serie)}<br>
    ${esc(new Date(receipt.issued_at).toLocaleString('es-ES'))}
  </div>
  ${isInvoice ? `
  <div class="sep"></div>
  <div>
    <strong>Cliente</strong><br>
    ${esc(receipt.receptor_name)}<br>
    NIF: ${esc(receipt.receptor_nif)}<br>
    ${receipt.receptor_address ? `${esc(receipt.receptor_address)}<br>` : ''}
  </div>` : ''}
  <div class="sep"></div>
  <table class="lines">
    <thead><tr><th>Ud</th><th>Concepto</th><th class="num">Importe</th></tr></thead>
    <tbody>
      ${lines.map((l) => `<tr>
        <td>${esc(l.qty)}</td>
        <td>${esc(l.name)}</td>
        <td class="num">${money(Number(l.line_base_cents) + Number(l.line_tax_cents), receipt.currency)}</td>
      </tr>`).join('\n      ')}
    </tbody>
  </table>
  <div class="sep"></div>
  <table class="totals">
    <tr><td>Base imponible</td><td class="num" style="text-align:right">${money(receipt.subtotal_cents, receipt.currency)}</td></tr>
    ${breakdown.map((b) => `<tr><td>IVA ${esc(b.rate)}%</td><td style="text-align:right">${money(b.quotaCents, receipt.currency)}</td></tr>`).join('\n    ')}
    <tr class="total"><td>TOTAL</td><td style="text-align:right">${money(receipt.total_cents, receipt.currency)}</td></tr>
  </table>
  ${receipt.qr_data_uri ? `
  <div class="qr"><img src="${esc(receipt.qr_data_uri)}" alt="QR Veri*Factu"></div>
  <div class="verifactu">QR tributario — Veri*Factu<br>${esc(receipt.verifactu_num_serie ?? receipt.num_serie)}</div>` : `
  <div class="verifactu">Registro Veri*Factu: ${esc(receipt.verifactu_status)}</div>`}
  ${footer ? `<div class="footer">${esc(footer)}</div>` : ''}
</body>
</html>`
}
