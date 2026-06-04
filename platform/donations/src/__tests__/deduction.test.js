import { describe, it, expect } from 'vitest'
import {
  computeIrpfDeduction, consecutiveYearsForLoyalty, DEDUCTION_CONSTANTS,
} from '../lib/deduction.js'

describe('computeIrpfDeduction', () => {
  it('importe ≤ 250 € → 80 % del total', () => {
    const r = computeIrpfDeduction(20000) // 200 €
    expect(r.firstBracketCents).toBe(20000)
    expect(r.excessCents).toBe(0)
    expect(r.deductibleCents).toBe(16000) // 80 % de 200 €
  })
  it('importe > 250 € sin fidelización → 80 % primeros 250 + 35 % exceso', () => {
    const r = computeIrpfDeduction(50000) // 500 €
    expect(r.firstBracketCents).toBe(25000)
    expect(r.excessCents).toBe(25000)
    expect(r.excessRate).toBe(0.35)
    // 80 % de 250 = 200 €, 35 % de 250 = 87,5 € → 287,5 € = 28750 céntimos
    expect(r.deductibleCents).toBe(28750)
  })
  it('importe > 250 € CON fidelización → 40 % sobre el exceso', () => {
    const r = computeIrpfDeduction(50000, true)
    expect(r.excessRate).toBe(0.40)
    // 200 € + 40 % de 250 = 100 € → 300 € = 30000
    expect(r.deductibleCents).toBe(30000)
    expect(r.loyal).toBe(true)
  })
  it('base 0 / negativa → 0', () => {
    expect(computeIrpfDeduction(0).deductibleCents).toBe(0)
    expect(computeIrpfDeduction(-500).deductibleCents).toBe(0)
  })
  it('exporta las constantes legales', () => {
    expect(DEDUCTION_CONSTANTS.FIRST_BRACKET_CENTS).toBe(25000)
    expect(DEDUCTION_CONSTANTS.LOYALTY_MIN_CONSECUTIVE_YEARS).toBe(3)
  })
})

describe('consecutiveYearsForLoyalty', () => {
  it('3 años consecutivos terminando en target → loyal', () => {
    const r = consecutiveYearsForLoyalty([2023, 2024, 2025], 2025)
    expect(r.consecutiveYears).toBe(3)
    expect(r.loyal).toBe(true)
  })
  it('2 años consecutivos → NO loyal', () => {
    const r = consecutiveYearsForLoyalty([2024, 2025], 2025)
    expect(r.consecutiveYears).toBe(2)
    expect(r.loyal).toBe(false)
  })
  it('hueco rompe la racha', () => {
    const r = consecutiveYearsForLoyalty([2021, 2023, 2024, 2025], 2025)
    expect(r.consecutiveYears).toBe(3)
    expect(r.loyal).toBe(true)
  })
  it('target sin donativo → 0 consecutivos, no loyal', () => {
    const r = consecutiveYearsForLoyalty([2022, 2023], 2025)
    expect(r.consecutiveYears).toBe(0)
    expect(r.loyal).toBe(false)
  })
  it('tolera duplicados y orden arbitrario', () => {
    const r = consecutiveYearsForLoyalty([2025, 2024, 2025, 2023], 2025)
    expect(r.consecutiveYears).toBe(3)
  })
  it('lista vacía/nula → 0', () => {
    expect(consecutiveYearsForLoyalty([], 2025).consecutiveYears).toBe(0)
    expect(consecutiveYearsForLoyalty(undefined, 2025).consecutiveYears).toBe(0)
  })
})
