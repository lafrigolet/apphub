import { useEffect, useState } from 'react'
import { getAccessToken } from '../lib/auth.js'

// Listado de certificados del socio. Consume:
//   GET /api/aikikan/certificates/me                — lista del socio
//   GET /api/aikikan/certificates/:id/download-url  — presigned URL via storage
//
// Al pulsar Descargar, pedimos el download URL y abrimos en una pestaña
// nueva. La URL caduca a los pocos minutos — pedimos una nueva en cada
// click para que un usuario que vuelva al cabo de un rato siga teniendo
// acceso.

async function api(method, path, body) {
  const token = getAccessToken()
  const res = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
  })
  if (res.status === 204) return null
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error?.message ?? res.statusText)
  return json
}

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })
}

function kindLabel(kind) {
  if (kind === 'grade')      return 'Diploma de grado'
  if (kind === 'attendance') return 'Constancia de asistencia'
  return kind
}

// Mapea el código interno de grado al texto humano. Mantiene el formato
// de app_aikikan.members.aikido_grade ('KYU_5', 'DAN_1', …).
function gradeLabel(code) {
  if (!code) return null
  const m = /^(KYU|DAN)_(\d+)$/.exec(code)
  if (!m) return code
  const ord = m[2]
  return m[1] === 'DAN' ? `${ord}º Dan` : `${ord}º Kyu`
}

export default function MemberCertificates({ onBack }) {
  const [items, setItems]     = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [busy, setBusy]       = useState({})  // { [certId]: true }

  function load() {
    setLoading(true); setError(null)
    api('GET', '/api/aikikan/certificates/me')
      .then((arr) => setItems(Array.isArray(arr) ? arr : []))
      .catch((err) => setError(err.message ?? 'Error'))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  async function download(cert) {
    setBusy((b) => ({ ...b, [cert.id]: true }))
    try {
      const res = await api('GET', `/api/aikikan/certificates/${cert.id}/download-url`)
      const url = res?.url ?? res?.data?.url
      if (!url) throw new Error('Respuesta sin URL')
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (err) {
      alert(err.message ?? 'Error al obtener el enlace')
    } finally {
      setBusy((b) => { const n = { ...b }; delete n[cert.id]; return n })
    }
  }

  return (
    <main className="member-home">
      <header className="member-home-nav">
        <div className="member-home-logo">AIKIKAN<span> /</span> CERTIFICADOS</div>
        <button className="member-home-logout" onClick={onBack}>← Volver</button>
      </header>

      <section className="member-home-hero">
        <p className="member-home-eyebrow"><span className="slash">/</span> Certificados</p>
        <h1 className="member-home-title">Tus diplomas</h1>
        <p className="member-home-lead">
          Diplomas de grado y constancias de asistencia. Cada PDF se sirve
          mediante un enlace temporal — pulsa "Descargar" cada vez que lo
          necesites.
        </p>
      </section>

      <div className="member-certs-wrap">
        {loading && <p className="dojos-empty">/ Cargando…</p>}
        {error && <p className="dojos-empty" style={{ color: 'var(--accent)' }}>/ Error: {error}</p>}

        {!loading && !error && (
          <section className="member-certs-block">
            <div className="member-certs-eyebrow"><span className="slash">/</span> Tus diplomas</div>
            <h2 className="member-certs-title">Certificados emitidos</h2>

            {items.length === 0 ? (
              <p className="dojos-empty">/ Aún no tienes certificados emitidos.</p>
            ) : (
              <div className="member-certs-list">
                {items.map((c) => (
                  <article key={c.id} className="member-cert-row">
                    <div className="member-cert-icon" aria-hidden>
                      {c.kind === 'grade' ? '◇' : '✓'}
                    </div>
                    <div className="member-cert-body">
                      <p className="member-cert-kind">{kindLabel(c.kind)}</p>
                      <p className="member-cert-title">{c.title}</p>
                      <p className="member-cert-meta">
                        {c.kind === 'grade' && c.grade_value && (
                          <span className="member-cert-grade">{gradeLabel(c.grade_value)}</span>
                        )}
                        {c.kind === 'grade' && c.grade_value && <span className="member-cert-sep"> · </span>}
                        <span>Emitido el {fmtDate(c.issued_at)}</span>
                      </p>
                      {c.notes && <p className="member-cert-notes">{c.notes}</p>}
                    </div>
                    <button
                      className="member-cert-download"
                      onClick={() => download(c)}
                      disabled={busy[c.id]}
                    >
                      {busy[c.id] ? 'Generando…' : 'Descargar PDF'}
                    </button>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  )
}
