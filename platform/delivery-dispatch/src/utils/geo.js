// Pure geo helpers — no external providers, no PII. All coordinates are plain numbers.

const R_EARTH_KM = 6371

/**
 * Great-circle distance between two {lat,lng} points, in kilometres (haversine).
 */
export function haversineKm(a, b) {
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R_EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * Extract the outer ring ([[lng,lat], …]) from a GeoJSON Polygon, a bare ring,
 * or a Feature wrapping a Polygon. Returns [] when nothing usable is found.
 */
function outerRing(polygon) {
  if (!polygon) return []
  const geom = polygon.type === 'Feature' ? polygon.geometry : polygon
  if (!geom) return []
  if (geom.type === 'Polygon' && Array.isArray(geom.coordinates)) {
    return geom.coordinates[0] ?? []
  }
  // Bare ring: [[lng,lat], …]
  if (Array.isArray(geom) && Array.isArray(geom[0])) return geom
  return []
}

/**
 * Ray-casting point-in-polygon. `point` is {lat,lng}; GeoJSON rings are [lng,lat].
 */
export function pointInPolygon(point, polygon) {
  const ring = outerRing(polygon)
  if (ring.length < 3) return false
  const x = point.lng
  const y = point.lat
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0]
    const yi = ring[i][1]
    const xj = ring[j][0]
    const yj = ring[j][1]
    const intersect =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

/**
 * Centroid ({lat,lng}) of a GeoJSON polygon's outer ring (simple average of vertices).
 * Used to estimate per-km distance when only the zone polygon is known.
 */
export function polygonCentroid(polygon) {
  const ring = outerRing(polygon)
  if (ring.length === 0) return null
  let sx = 0
  let sy = 0
  for (const [lng, lat] of ring) { sx += lng; sy += lat }
  return { lat: sy / ring.length, lng: sx / ring.length }
}
