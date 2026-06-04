// At-rest encryption of submission `answers` (special-category health data,
// art. 9 GDPR). Recommendation #1 of docs/use-cases/intake-forms.md.
//
// Encrypted rows store `answers_encrypted` (BYTEA = iv||tag||ciphertext) and a
// blanked `answers = '{}'` plaintext column. Legacy rows (written before the
// 0003 migration, or after erasure) keep their plaintext `answers` and have a
// NULL `answers_encrypted`. `decodeAnswers` transparently handles both shapes.
import { encryptSecret, decryptSecret } from '@apphub/platform-sdk/crypto'

// Serialise an answers object to a BYTEA-ready encrypted buffer.
// Returns null for null/empty input (so the column stays NULL).
export function encodeAnswers(answers) {
  if (answers == null) return null
  return encryptSecret(JSON.stringify(answers))
}

// Given a raw submission row, return a copy with `answers` resolved to the
// decrypted plaintext object and `answers_encrypted` stripped from the result.
// Falls back to the plaintext `answers` column for legacy / erased rows.
export function decodeSubmissionRow(row) {
  if (!row) return row
  const { answers_encrypted, ...rest } = row
  if (answers_encrypted != null) {
    const buf = Buffer.isBuffer(answers_encrypted) ? answers_encrypted : Buffer.from(answers_encrypted)
    rest.answers = JSON.parse(decryptSecret(buf))
  }
  return rest
}
