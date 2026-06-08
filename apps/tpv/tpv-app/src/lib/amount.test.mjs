// Test sin dependencias: `node src/lib/amount.test.mjs`. Cubre la tecla "00".
import assert from 'node:assert/strict'
import { pressDigit, pressDoubleZero, backspace, clear, formatAmount, formatEur, MAX_CENTS } from './amount.js'

let n = 0
const t = (name, fn) => { fn(); n++; }

t('teclear 1,2,5,0 → 1250 céntimos', () => {
  let c = 0
  for (const d of [1, 2, 5, 0]) c = pressDigit(c, d)
  assert.equal(c, 1250)
  assert.equal(formatEur(c), '12,50 €')
})

t('tecla "00": 12 + 00 → 1200 (12,00 €)', () => {
  let c = 0
  c = pressDigit(c, 1)
  c = pressDigit(c, 2)
  c = pressDoubleZero(c)
  assert.equal(c, 1200)
  assert.equal(formatEur(c), '12,00 €')
})

t('"00" desde 5 → 500 (5,00 €)', () => {
  let c = pressDigit(0, 5)
  c = pressDoubleZero(c)
  assert.equal(c, 500)
})

t('backspace quita el último dígito', () => {
  let c = 0
  for (const d of [9, 9, 9]) c = pressDigit(c, d)   // 999
  c = backspace(c)
  assert.equal(c, 99)
  assert.equal(formatEur(c), '0,99 €')
})

t('clear vuelve a 0', () => {
  assert.equal(clear(), 0)
})

t('respeta el tope MAX_CENTS', () => {
  let c = MAX_CENTS
  assert.equal(pressDigit(c, 9), MAX_CENTS, 'no crece por encima del tope')
  assert.equal(pressDoubleZero(c), MAX_CENTS, '"00" tampoco sobrepasa el tope')
})

t('dígitos inválidos se ignoran', () => {
  assert.equal(pressDigit(12, 'x'), 12)
})

t('formato con miles', () => {
  assert.equal(formatAmount(123456789), '1.234.567,89')
})

console.log(`✓ amount: ${n} tests OK`)
