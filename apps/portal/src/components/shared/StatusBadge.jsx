import Badge from '../ui/Badge'

const TX_STATUS = {
  succeeded:  { variant: 'green',  label: 'Completado'  },
  processing: { variant: 'yellow', label: 'Procesando'  },
  refunded:   { variant: 'gray',   label: 'Reembolsado' },
  failed:     { variant: 'red',    label: 'Fallido'      },
}

const MERCHANT_STATUS = {
  active:     { variant: 'green',  label: 'Activo'      },
  pending:    { variant: 'yellow', label: 'Pendiente'   },
  restricted: { variant: 'red',    label: 'Restringido' },
  blocked:    { variant: 'red',    label: 'Bloqueado'   },
}

const PAYOUT_STATUS = {
  paid:       { variant: 'green',  label: 'Pagado'      },
  in_transit: { variant: 'yellow', label: 'En tránsito' },
  pending:    { variant: 'gray',   label: 'Pendiente'   },
  failed:     { variant: 'red',    label: 'Fallido'      },
}

function resolve(map, status) {
  const entry = map[status]
  return entry ?? { variant: 'gray', label: status }
}

export function TxStatusBadge({ status }) {
  const { variant, label } = resolve(TX_STATUS, status)
  return <Badge variant={variant}>{label}</Badge>
}

export function MerchantStatusBadge({ status }) {
  const { variant, label } = resolve(MERCHANT_STATUS, status)
  return <Badge variant={variant}>{label}</Badge>
}

export function PayoutStatusBadge({ status }) {
  const { variant, label } = resolve(PAYOUT_STATUS, status)
  return <Badge variant={variant}>{label}</Badge>
}
