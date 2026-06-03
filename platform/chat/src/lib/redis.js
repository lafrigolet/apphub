// Redis del módulo chat — inyectado por register() (igual que configurePool).
// Se usa para dos cosas:
//   1. Publicar eventos de dominio en `platform.events` (consumidos por
//      notifications para push/email cuando el destinatario está offline).
//   2. Fan-out en tiempo real entre instancias de platform-core: el servicio
//      publica en `chat:rt:{appId}:{tenantId}` y cada instancia reenvía a sus
//      sockets WebSocket conectados (ver ws/gateway.js).
// Si no se configura (p.ej. tests unit), getRedis() devuelve null y los
// publishers se vuelven no-ops.
let redis = null

export function configureRedis(r) {
  redis = r
}

export function getRedis() {
  return redis
}

export const PLATFORM_EVENTS_CHANNEL = 'platform.events'

export function rtChannel(appId, tenantId) {
  return `chat:rt:${appId}:${tenantId}`
}

// Publica un evento de dominio en el bus `platform.events`. No-op si redis no
// está configurado. Nunca lanza: un fallo de publish no debe tumbar la escritura.
export async function publishPlatformEvent(type, payload) {
  if (!redis) return
  try {
    await redis.publish(PLATFORM_EVENTS_CHANNEL, JSON.stringify({ type, payload }))
  } catch {
    // best-effort
  }
}

// Publica un frame de tiempo real para fan-out cross-instancia. No-op si redis
// no está configurado.
export async function publishRealtime(appId, tenantId, frame) {
  if (!redis) return
  try {
    await redis.publish(rtChannel(appId, tenantId), JSON.stringify(frame))
  } catch {
    // best-effort
  }
}
