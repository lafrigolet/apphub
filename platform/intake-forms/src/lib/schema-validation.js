// Server-side validation of submitted answers against a template schema
// (use-case #4 of docs/use-cases/intake-forms.md).
//
// The template `schema` JSONB is free-form, but when it declares a normalized
// `fields` array we enforce the contract before allowing a `submit`. Supported
// per-field properties: `key` (required), `type`, `label`, `required`,
// `min`/`max` (number range or text length), `options` (allowed values for
// select/radio/multiselect). Unknown field types are accepted as-is (forward
// compatible with the field-type catalogue in §2 that is not yet normalized).
//
// Returns an array of { field, code, message } errors — empty when valid.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function isEmpty(v) {
  return v == null || v === '' || (Array.isArray(v) && v.length === 0)
}

export function validateAnswers(schema, answers = {}) {
  const fields = Array.isArray(schema?.fields) ? schema.fields : null
  if (!fields) return [] // free-form schema: nothing to enforce
  const errors = []
  const push = (field, code, message) => errors.push({ field, code, message })

  for (const f of fields) {
    if (!f || !f.key) continue
    const value = answers[f.key]
    const required = f.required === true

    if (isEmpty(value)) {
      if (required) push(f.key, 'required', `Field "${f.label ?? f.key}" is required`)
      continue
    }

    switch (f.type) {
      case 'number':
      case 'scale':
      case 'rating': {
        const n = typeof value === 'number' ? value : Number(value)
        if (Number.isNaN(n)) { push(f.key, 'type', `Field "${f.key}" must be a number`); break }
        if (f.min != null && n < f.min) push(f.key, 'min', `Field "${f.key}" must be >= ${f.min}`)
        if (f.max != null && n > f.max) push(f.key, 'max', `Field "${f.key}" must be <= ${f.max}`)
        break
      }
      case 'text':
      case 'textarea': {
        const s = String(value)
        if (f.min != null && s.length < f.min) push(f.key, 'minLength', `Field "${f.key}" is too short`)
        if (f.max != null && s.length > f.max) push(f.key, 'maxLength', `Field "${f.key}" is too long`)
        break
      }
      case 'email':
        if (!EMAIL_RE.test(String(value))) push(f.key, 'format', `Field "${f.key}" must be a valid email`)
        break
      case 'select':
      case 'radio': {
        const opts = Array.isArray(f.options) ? f.options.map(optValue) : null
        if (opts && !opts.includes(value)) push(f.key, 'option', `Field "${f.key}" has an invalid value`)
        break
      }
      case 'multiselect': {
        const opts = Array.isArray(f.options) ? f.options.map(optValue) : null
        const arr = Array.isArray(value) ? value : [value]
        if (opts && !arr.every((v) => opts.includes(v))) push(f.key, 'option', `Field "${f.key}" has an invalid value`)
        break
      }
      default:
        break // unknown/forward-compatible types: presence already checked
    }
  }
  return errors
}

// Options may be plain scalars or { value, label } objects.
function optValue(o) {
  return o != null && typeof o === 'object' ? o.value : o
}
