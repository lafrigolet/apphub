import pg from 'pg'
import bcrypt from 'bcrypt'
import { randomUUID } from 'crypto'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

const PASSWORD = 'Yoga1234!'
const COST = 12

const users = [
  { email: 'alumno@yoga.es',     role: 'alumno' },
  { email: 'instructor@yoga.es', role: 'instructor' },
  { email: 'admin@yoga.es',      role: 'admin' },
]

async function seed() {
  const client = await pool.connect()
  try {
    for (const u of users) {
      const hash = await bcrypt.hash(PASSWORD, COST)
      await client.query(
        `INSERT INTO yoga_auth.users (id, email, password_hash, role, email_confirmed)
         VALUES ($1, $2, $3, $4, true)
         ON CONFLICT (email) DO UPDATE
           SET password_hash = EXCLUDED.password_hash,
               role          = EXCLUDED.role,
               email_confirmed = true`,
        [randomUUID(), u.email, hash, u.role],
      )
      console.log(`✓ ${u.role.padEnd(12)} ${u.email}`)
    }
    console.log(`\nContraseña para todos: ${PASSWORD}`)
  } finally {
    client.release()
    await pool.end()
  }
}

seed().catch(err => { console.error(err); process.exit(1) })
