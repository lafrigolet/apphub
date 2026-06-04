import { describe, it, expect } from 'vitest'
import { haversineKm, pointInPolygon, polygonCentroid } from '../utils/geo.js'

// A ~ 1.1km-wide square around (lat 40.40..40.41, lng -3.71..-3.70)
const square = {
  type: 'Polygon',
  coordinates: [[
    [-3.71, 40.40],
    [-3.70, 40.40],
    [-3.70, 40.41],
    [-3.71, 40.41],
    [-3.71, 40.40],
  ]],
}

describe('haversineKm', () => {
  it('returns 0 for identical points', () => {
    expect(haversineKm({ lat: 40, lng: -3 }, { lat: 40, lng: -3 })).toBe(0)
  })
  it('approximates a known distance (~111km per degree of latitude)', () => {
    const d = haversineKm({ lat: 40, lng: -3 }, { lat: 41, lng: -3 })
    expect(d).toBeGreaterThan(110)
    expect(d).toBeLessThan(112)
  })
})

describe('pointInPolygon', () => {
  it('detects a point inside the polygon', () => {
    expect(pointInPolygon({ lat: 40.405, lng: -3.705 }, square)).toBe(true)
  })
  it('detects a point outside the polygon', () => {
    expect(pointInPolygon({ lat: 40.50, lng: -3.705 }, square)).toBe(false)
  })
  it('accepts a GeoJSON Feature wrapper', () => {
    const feature = { type: 'Feature', geometry: square }
    expect(pointInPolygon({ lat: 40.405, lng: -3.705 }, feature)).toBe(true)
  })
  it('returns false for degenerate polygons', () => {
    expect(pointInPolygon({ lat: 0, lng: 0 }, null)).toBe(false)
    expect(pointInPolygon({ lat: 0, lng: 0 }, { type: 'Polygon', coordinates: [[[0, 0]]] })).toBe(false)
  })
})

describe('polygonCentroid', () => {
  it('returns the average vertex of the square', () => {
    const c = polygonCentroid(square)
    expect(c.lat).toBeCloseTo(40.405, 2)
    expect(c.lng).toBeCloseTo(-3.705, 2)
  })
  it('returns null for empty polygon', () => {
    expect(polygonCentroid(null)).toBeNull()
  })
})
