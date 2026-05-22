// Tests del template renderer: interpolación segura de variables,
// fallback de locale, y comportamiento frente a strings sospechosas.
//
// La función `renderString` NO escapa HTML — el contrato es: el caller
// que pinta HTML debe enviar el template ya escapado, y el text body
// nunca se renderiza como HTML. Aún así, verificamos que no inyecta
// chars peligrosos por accidente.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/db.js', () => ({ pool: { connect: vi.fn() } }))
vi.mock('../repositories/templates.repository.js', () => ({
  findByKey: vi.fn(),
}))

import { renderString, renderTemplate } from '../services/template-renderer.js'
import { pool } from '../lib/db.js'
import * as repo from '../repositories/templates.repository.js'

beforeEach(() => vi.clearAllMocks())

// ── renderString ────────────────────────────────────────────────────────

describe('renderString — interpolación {{var}}', () => {
  it('reemplaza {{name}} por la variable correspondiente', () => {
    expect(renderString('Hola {{name}}!', { name: 'Daniel' })).toBe('Hola Daniel!')
  })

  it('soporta paths con punto (no, los trata como key literal)', () => {
    // El regex captura [a-zA-Z0-9_.]+ pero vars[key] busca el literal "user.email".
    // Sin nested path, esto es null → string vacío.
    expect(renderString('{{user.email}}', { 'user.email': 'x@y.org' })).toBe('x@y.org')
    expect(renderString('{{user.email}}', { user: { email: 'x@y.org' } })).toBe('')
  })

  it('vars desconocidas → string vacío (no rompe el flow)', () => {
    expect(renderString('Hola {{nombre}}, código {{otro}}', { nombre: 'A' })).toBe('Hola A, código ')
  })

  it('null/undefined var → string vacío', () => {
    expect(renderString('{{x}}', { x: null })).toBe('')
    expect(renderString('{{x}}', { x: undefined })).toBe('')
  })

  it('valores numéricos se stringifican', () => {
    expect(renderString('Total: {{n}} €', { n: 42 })).toBe('Total: 42 €')
    expect(renderString('Año: {{y}}', { y: 0 })).toBe('Año: 0')   // no se trata como falsy null
  })

  it('whitespace alrededor de la key se ignora', () => {
    expect(renderString('Hola {{  name  }}!', { name: 'Eva' })).toBe('Hola Eva!')
  })

  it('caracteres < > & en valores se mantienen LITERALES (no escapa; caller responsable)', () => {
    // Esto documenta el contrato actual: el renderer NO escapa HTML.
    // Si el caller pinta el resultado en HTML, debe escapar — pero el text
    // body de un email NUNCA debería pintarse como HTML.
    const r = renderString('Soy {{nombre}}', { nombre: '<script>alert(1)</script>' })
    expect(r).toBe('Soy <script>alert(1)</script>')   // tal cual
  })

  it('NO ejecuta JS por más feo que sea el valor (es string replacement, no template engine)', () => {
    const r = renderString('{{x}}', { x: '`${process.exit(1)}`' })
    expect(r).toBe('`${process.exit(1)}`')
  })

  it('template null/undefined → devuelve el mismo valor sin throw', () => {
    expect(renderString(null, {})).toBeNull()
    expect(renderString(undefined, {})).toBeUndefined()
  })
})

// ── renderTemplate (DB-backed, locale + channel) ────────────────────────

describe('renderTemplate — (key, channel, locale)', () => {
  it('llama al repo con (key, channel, locale) y renderiza subject/text/html', async () => {
    const client = { release: vi.fn() }
    pool.connect.mockResolvedValue(client)
    repo.findByKey.mockResolvedValue({
      subject:   'Hola {{name}}',
      body_text: 'Bienvenido a {{appName}}',
      body_html: '<p>Hola <b>{{name}}</b></p>',
      locale:    'es',
    })

    const r = await renderTemplate('user.welcome', { name: 'Eva', appName: 'AulaVera' }, 'email', 'es')

    expect(repo.findByKey).toHaveBeenCalledWith(client, 'user.welcome', 'email', 'es')
    expect(r).toEqual({
      subject: 'Hola Eva',
      text:    'Bienvenido a AulaVera',
      html:    '<p>Hola <b>Eva</b></p>',
      locale:  'es',
    })
  })

  it('defaults: channel=email, locale=es', async () => {
    const client = { release: vi.fn() }
    pool.connect.mockResolvedValue(client)
    repo.findByKey.mockResolvedValue({ subject: 'X', body_text: 'Y', body_html: '', locale: 'es' })

    await renderTemplate('user.welcome', {})

    expect(repo.findByKey).toHaveBeenCalledWith(client, 'user.welcome', 'email', 'es')
  })

  it('locale en (key, channel) inexistente → repo devuelve fallback (lo gestiona el repo, contrato)', async () => {
    const client = { release: vi.fn() }
    pool.connect.mockResolvedValue(client)
    // Simulamos que repo aplicó su propio fallback a 'es'.
    repo.findByKey.mockResolvedValue({ subject: '[es]', body_text: 't', body_html: '', locale: 'es' })

    const r = await renderTemplate('user.welcome', {}, 'email', 'pt')
    expect(r.locale).toBe('es')   // el repo cayó al fallback
  })

  it('si el repo devuelve null (template no existe), renderTemplate devuelve null (caller usa default hardcoded)', async () => {
    const client = { release: vi.fn() }
    pool.connect.mockResolvedValue(client)
    repo.findByKey.mockResolvedValue(null)

    const r = await renderTemplate('inexistente', {}, 'email', 'es')
    expect(r).toBeNull()
  })

  it('libera la conexión incluso si el repo lanza', async () => {
    const client = { release: vi.fn() }
    pool.connect.mockResolvedValue(client)
    repo.findByKey.mockRejectedValueOnce(new Error('db down'))

    await expect(renderTemplate('x', {}, 'email', 'es')).rejects.toThrow('db down')
    expect(client.release).toHaveBeenCalledTimes(1)
  })
})
