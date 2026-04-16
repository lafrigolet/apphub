export const MOCK_SPLIT_RULES = [
  { id: 1, name: 'Marketplace Estándar', platform: 15, merchant: 80, affiliate: 5,  active: true  },
  { id: 2, name: 'Premium Partner',      platform: 10, merchant: 90, affiliate: 0,  active: true  },
  { id: 3, name: 'Co-venta Franquicia',  platform: 20, merchant: 65, affiliate: 15, active: false },
]

export const MOCK_MERCHANTS = [
  { id: 'acct_A1B2C3', name: 'Casa del Agua Madrid',     status: 'active',      rule: 'Marketplace Estándar', balance: 3240.50, volume: 18450, joined: '2024-11-15' },
  { id: 'acct_D4E5F6', name: 'Eco Spa Barcelona',        status: 'active',      rule: 'Premium Partner',      balance: 890.00,  volume: 6200,  joined: '2025-01-08' },
  { id: 'acct_G7H8I9', name: 'Wellness Center Valencia', status: 'pending',     rule: 'Marketplace Estándar', balance: 0,       volume: 0,     joined: '2025-03-10' },
  { id: 'acct_J0K1L2', name: 'Balneario Las Flores',     status: 'restricted',  rule: 'Co-venta Franquicia',  balance: 120.00,  volume: 4100,  joined: '2024-09-22' },
]

export const MOCK_TRANSACTIONS = [
  { id: 'pi_3Nx1', amount: 89.00,  merchant: 'Casa del Agua Madrid', method: 'Visa •••• 4242',   status: 'succeeded',  date: '2025-04-11 14:32', split: { platform: 13.35, merchant: 71.20, affiliate: 4.45, stripe: 2.88 } },
  { id: 'pi_3Nx2', amount: 245.00, merchant: 'Eco Spa Barcelona',    method: 'Apple Pay',          status: 'succeeded',  date: '2025-04-11 13:15', split: { platform: 24.50, merchant: 220.50, affiliate: 0,    stripe: 7.41 } },
  { id: 'pi_3Nx3', amount: 34.50,  merchant: 'Casa del Agua Madrid', method: 'Visa •••• 5678',   status: 'refunded',   date: '2025-04-11 11:00', split: { platform: 5.18,  merchant: 27.60,  affiliate: 1.73, stripe: 1.12 } },
  { id: 'pi_3Nx4', amount: 178.00, merchant: 'Casa del Agua Madrid', method: 'Google Pay',         status: 'succeeded',  date: '2025-04-10 17:45', split: { platform: 26.70, merchant: 142.40, affiliate: 8.90, stripe: 5.47 } },
  { id: 'pi_3Nx5', amount: 56.00,  merchant: 'Eco Spa Barcelona',    method: 'SEPA •••• 9012',   status: 'processing', date: '2025-04-10 16:20', split: { platform: 5.60,  merchant: 50.40,  affiliate: 0,    stripe: 1.82 } },
]

export const MOCK_DISPUTES = [
  { id: 'dp_1A2B', amount: 89.00,  merchant: 'Casa del Agua Madrid', reason: 'Cargo no reconocido',  status: 'needs_response', deadline: '2025-04-15', transaction: 'pi_3Nx1' },
  { id: 'dp_3C4D', amount: 178.00, merchant: 'Casa del Agua Madrid', reason: 'Producto no recibido', status: 'needs_response', deadline: '2025-04-18', transaction: 'pi_3Nx4' },
]

export const MOCK_PAYOUTS = [
  { id: 'po_A1', merchant: 'Casa del Agua Madrid', amount: 3240.50, status: 'paid',       date: '2025-04-10', transactions: 24 },
  { id: 'po_B2', merchant: 'Eco Spa Barcelona',    amount: 890.00,  status: 'in_transit', date: '2025-04-11', transactions: 8  },
  { id: 'po_C3', merchant: 'Balneario Las Flores', amount: 120.00,  status: 'pending',    date: '2025-04-13', transactions: 3  },
]
