// Server-side required-field + type validation (use-case #4).
import { describe, it, expect } from 'vitest'
import { validateAnswers } from '../lib/schema-validation.js'

describe('validateAnswers — no normalized schema', () => {
  it('returns [] when schema has no fields array (free-form)', () => {
    expect(validateAnswers({}, { a: 1 })).toEqual([])
    expect(validateAnswers(null, {})).toEqual([])
    expect(validateAnswers({ fields: 'nope' }, {})).toEqual([])
  })
})

describe('validateAnswers — required', () => {
  const schema = { fields: [{ key: 'name', label: 'Name', required: true }, { key: 'opt' }] }

  it('flags a missing required field', () => {
    const errs = validateAnswers(schema, {})
    expect(errs).toHaveLength(1)
    expect(errs[0]).toMatchObject({ field: 'name', code: 'required' })
  })

  it('treats empty string / empty array as missing', () => {
    expect(validateAnswers(schema, { name: '' })[0].code).toBe('required')
    expect(validateAnswers(schema, { name: [] })[0].code).toBe('required')
  })

  it('passes when required field present; optional missing is fine', () => {
    expect(validateAnswers(schema, { name: 'Ana' })).toEqual([])
  })

  it('skips fields without a key', () => {
    expect(validateAnswers({ fields: [{ label: 'no key', required: true }] }, {})).toEqual([])
  })
})

describe('validateAnswers — number / scale range', () => {
  const schema = { fields: [{ key: 'age', type: 'number', min: 0, max: 120 }] }

  it('rejects non-numeric', () => {
    expect(validateAnswers(schema, { age: 'abc' })[0].code).toBe('type')
  })
  it('enforces min and max', () => {
    expect(validateAnswers(schema, { age: -1 })[0].code).toBe('min')
    expect(validateAnswers(schema, { age: 200 })[0].code).toBe('max')
  })
  it('accepts in-range and numeric strings', () => {
    expect(validateAnswers(schema, { age: 30 })).toEqual([])
    expect(validateAnswers(schema, { age: '30' })).toEqual([])
  })
})

describe('validateAnswers — text length', () => {
  const schema = { fields: [{ key: 'bio', type: 'text', min: 2, max: 5 }] }
  it('flags too short and too long', () => {
    expect(validateAnswers(schema, { bio: 'a' })[0].code).toBe('minLength')
    expect(validateAnswers(schema, { bio: 'abcdef' })[0].code).toBe('maxLength')
  })
  it('accepts within range', () => {
    expect(validateAnswers(schema, { bio: 'abc' })).toEqual([])
  })
})

describe('validateAnswers — email', () => {
  const schema = { fields: [{ key: 'mail', type: 'email' }] }
  it('rejects invalid email', () => {
    expect(validateAnswers(schema, { mail: 'nope' })[0].code).toBe('format')
  })
  it('accepts valid email', () => {
    expect(validateAnswers(schema, { mail: 'a@b.com' })).toEqual([])
  })
})

describe('validateAnswers — select/radio/multiselect options', () => {
  it('rejects a value outside scalar options (select)', () => {
    const schema = { fields: [{ key: 'c', type: 'select', options: ['a', 'b'] }] }
    expect(validateAnswers(schema, { c: 'z' })[0].code).toBe('option')
    expect(validateAnswers(schema, { c: 'a' })).toEqual([])
  })

  it('supports { value, label } option objects (radio)', () => {
    const schema = { fields: [{ key: 'c', type: 'radio', options: [{ value: 'a', label: 'A' }] }] }
    expect(validateAnswers(schema, { c: 'a' })).toEqual([])
    expect(validateAnswers(schema, { c: 'x' })[0].code).toBe('option')
  })

  it('multiselect requires every value to be an allowed option', () => {
    const schema = { fields: [{ key: 'c', type: 'multiselect', options: ['a', 'b'] }] }
    expect(validateAnswers(schema, { c: ['a', 'b'] })).toEqual([])
    expect(validateAnswers(schema, { c: ['a', 'z'] })[0].code).toBe('option')
  })
})

describe('validateAnswers — unknown type', () => {
  it('accepts unknown field types once present', () => {
    const schema = { fields: [{ key: 'sig', type: 'signature', required: true }] }
    expect(validateAnswers(schema, { sig: 'data:image/png;base64,xxx' })).toEqual([])
  })
})
