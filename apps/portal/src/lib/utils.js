/** Returns up to 2 uppercase initials from a name string */
export function avatarInitials(name) {
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

/** Format a number as euros: 1234.5 → "€ 1.234,50" */
export function formatCurrency(amount) {
  return '€ ' + amount.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/**
 * Compute Stripe fee and net split for a given amount and rule.
 * Returns { stripeFee, net, merchant, platform, affiliate }
 */
export function calcSplit(amount, rule) {
  const stripeFee = parseFloat((amount * 0.029 + 0.30).toFixed(2))
  const net       = parseFloat((amount - stripeFee).toFixed(2))
  return {
    stripeFee,
    net,
    merchant:  parseFloat((net * rule.merchant  / 100).toFixed(2)),
    platform:  parseFloat((net * rule.platform  / 100).toFixed(2)),
    affiliate: parseFloat((net * rule.affiliate / 100).toFixed(2)),
  }
}
