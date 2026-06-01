// Redis del módulo leads — inyectado por register() (igual que configurePool).
// Se usa para publicar eventos de dominio en `platform.events`; si no se
// configura (p.ej. en tests unit), getRedis() devuelve null y los publishers
// se vuelven no-ops.
let redis = null

export function configureRedis(r) {
  redis = r
}

export function getRedis() {
  return redis
}
