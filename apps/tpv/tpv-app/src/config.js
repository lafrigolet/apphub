import { Platform } from 'react-native'

// Base del gateway NGINX del stack AppHub.
//   - Emulador Android: 10.0.2.2 es el host desde la VM.
//   - Simulador iOS: localhost funciona.
//   - Dispositivo físico: pon la IP LAN del host (p.ej. http://192.168.1.50:8080).
// Sobrescribible con EXPO_PUBLIC_API_BASE.
const DEFAULT_BASE = Platform.select({
  android: 'http://10.0.2.2:8080',
  ios: 'http://localhost:8080',
  default: 'http://localhost:8080',
})

export const API_BASE = process.env.EXPO_PUBLIC_API_BASE ?? DEFAULT_BASE

// Prefijo de las rutas. Contra el gateway NGINX: '/api' (reescribe a /v1 en core).
// Contra platform-core directo (dev en dispositivo físico, sin routing por Host): '/v1'.
export const API_PREFIX = process.env.EXPO_PUBLIC_API_PREFIX ?? '/api'

// Tenant de prueba + credenciales del cajero seedeadas por apps/tpv/seed.sql.
// Login silencioso (V1 sin pantalla de login). En producción esto se sustituye
// por un login real del cajero.
export const APP_ID = 'tpv'
export const TENANT_ID = '60000000-0000-0000-0000-000000000001'
export const DEV_EMAIL = process.env.EXPO_PUBLIC_DEV_EMAIL ?? 'cajero@tpv.local'
export const DEV_PASSWORD = process.env.EXPO_PUBLIC_DEV_PASSWORD ?? 'tpv1234'

export const CURRENCY = 'eur'
