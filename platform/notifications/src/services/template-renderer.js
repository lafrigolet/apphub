import { pool } from '../lib/db.js'
import * as repo from '../repositories/templates.repository.js'

// Tiny `{{var}}` interpolator. Unknown vars render as empty strings rather
// than leaving the placeholder visible — the alternative would be to throw,
// but a missing template variable shouldn't break a user-visible flow.
export function renderString(template, vars) {
  if (!template) return template
  return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, key) => {
    const value = vars?.[key]
    return value == null ? '' : String(value)
  })
}

// Look up a template by (key, channel, locale) in the DB and render it with
// `vars`. Default channel is 'email' and default locale is 'es' for
// back-compat with existing callers. The repository falls back to 'es' when
// the requested locale has no row, so passing an unknown locale never breaks
// — it just degrades to Spanish. Returns { subject, text, html, locale } on
// hit; null on miss (caller falls back to a hardcoded default).
export async function renderTemplate(key, vars, channel = 'email', locale = 'es') {
  const client = await pool.connect()
  let row
  try {
    row = await repo.findByKey(client, key, channel, locale)
  } finally {
    client.release()
  }
  if (!row) return null
  return {
    subject: renderString(row.subject, vars),
    text:    renderString(row.body_text, vars),
    html:    renderString(row.body_html, vars),
    locale:  row.locale,
  }
}
