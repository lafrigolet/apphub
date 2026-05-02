import { useEffect, useState } from 'react'
import { getAccessToken } from '../lib/auth.js'

// Llama al endpoint con el JWT en Authorization. Mantenemos esto local —
// el resto del portal aikikan no necesita un cliente HTTP genérico hoy;
// si crece, se extrae a lib/api.js. Devuelve `data` o lanza Error con el
// mensaje del backend.
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
  return new Date(iso).toLocaleDateString('es-ES', {
    day: 'numeric', month: 'long', year: 'numeric',
  })
}

function fmtDateTime(iso) {
  if (!iso) return 'Nunca'
  return new Date(iso).toLocaleString('es-ES', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

// Aikido grades pretty-printed.
const GRADE_LABEL = {
  KYU_6: '6º Kyu', KYU_5: '5º Kyu', KYU_4: '4º Kyu', KYU_3: '3º Kyu',
  KYU_2: '2º Kyu', KYU_1: '1º Kyu',
  DAN_1: 'Shodan (1º Dan)', DAN_2: 'Nidan (2º Dan)', DAN_3: 'Sandan (3º Dan)',
  DAN_4: 'Yondan (4º Dan)', DAN_5: 'Godan (5º Dan)',
}

export default function MemberProfile({ onBack }) {
  // El componente compone DOS fuentes:
  //   - identity: lo que platform_auth conoce (email, role, created_at, last_login_at)
  //   - member:  datos de socio en app_aikikan (member_number, aikido_grade, …)
  // Cada lado se edita con su propio PATCH; nunca se mezcla en una sola request.
  const [user, setUser]         = useState(null)
  const [member, setMember]     = useState(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)
  const [editing, setEditing]   = useState(false)         // 'name' | 'member' | null
  const [savedAt, setSavedAt]   = useState(null)
  const [saving, setSaving]     = useState(false)

  // Form state.
  const [name, setName]         = useState('')
  const [memberForm, setMemberForm] = useState({
    memberNumber: '', memberSince: '', aikidoGrade: '', dojoName: '',
  })

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    Promise.all([
      api('GET', '/api/users/me'),
      api('GET', '/api/aikikan/members/me').catch(() => null),  // si aún no hay perfil, ok
    ])
      .then(([u, m]) => {
        if (cancelled) return
        setUser(u)
        setName(u?.display_name ?? '')
        // Endpoint puede devolver { empty: true } cuando no hay fila aún.
        const real = (m && !m.empty) ? m : null
        setMember(real)
        setMemberForm({
          memberNumber: real?.member_number ?? '',
          memberSince:  real?.member_since?.slice(0, 10) ?? '',
          aikidoGrade:  real?.aikido_grade ?? '',
          dojoName:     real?.dojo_name ?? '',
        })
      })
      .catch((e) => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  async function saveName(e) {
    e.preventDefault()
    setSaving(true); setError(null)
    try {
      const updated = await api('PATCH', '/api/users/me', { displayName: name })
      setUser(updated)
      setEditing(null); setSavedAt(Date.now())
    } catch (err) { setError(err.message) } finally { setSaving(false) }
  }

  async function saveMember(e) {
    e.preventDefault()
    setSaving(true); setError(null)
    try {
      // Solo enviamos los campos rellenos (PATCH parcial).
      const body = {}
      if (memberForm.memberNumber) body.memberNumber = memberForm.memberNumber
      if (memberForm.memberSince)  body.memberSince  = memberForm.memberSince
      if (memberForm.aikidoGrade)  body.aikidoGrade  = memberForm.aikidoGrade
      if (memberForm.dojoName)     body.dojoName     = memberForm.dojoName
      const updated = await api('PATCH', '/api/aikikan/members/me', body)
      setMember(updated)
      setEditing(null); setSavedAt(Date.now())
    } catch (err) { setError(err.message) } finally { setSaving(false) }
  }

  return (
    <main className="member-home">
      <header className="member-home-nav">
        <div className="member-home-logo">AIKIKAN<span> /</span> MI PERFIL</div>
        <button className="member-home-logout" onClick={onBack}>← Volver</button>
      </header>

      <section className="member-home-hero">
        <p className="member-home-eyebrow"><span className="slash">/</span> Mi perfil</p>
        <h1 className="member-home-title">
          {editing ? 'Editar perfil' : <>Hola, <span className="member-home-name">{user?.display_name?.split(' ')[0] ?? '…'}</span></>}
        </h1>
      </section>

      {loading && <div className="member-profile-loading">Cargando…</div>}
      {error   && <div className="member-profile-error">Error: {error}</div>}

      {!loading && user && (
        <>
          {/* ── Identidad — fuente: platform_auth ── */}
          <section className="member-profile-card">
            <div className="member-profile-section-title">Identidad</div>
            {editing === 'name' ? (
              <form onSubmit={saveName} className="member-profile-form">
                <div className="member-profile-field">
                  <label className="member-profile-label">Nombre completo</label>
                  <input
                    className="member-profile-input"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={128} autoFocus
                  />
                </div>
                <p className="member-profile-readonly">
                  <span>{user.email}</span> · <span>{user.role}</span> — el email y el rol los gestiona la asociación.
                </p>
                <div className="member-profile-actions">
                  <button type="button" className="member-home-logout" onClick={() => { setName(user.display_name ?? ''); setEditing(null); setError(null) }} disabled={saving}>Cancelar</button>
                  <button type="submit" className="member-home-logout member-profile-primary" disabled={saving || !name.trim()}>
                    {saving ? 'Guardando…' : 'Guardar'}
                  </button>
                </div>
              </form>
            ) : (
              <>
                <dl className="member-profile-dl">
                  <div><dt>Nombre</dt><dd>{user.display_name ?? <em>sin definir</em>}</dd></div>
                  <div><dt>Email</dt><dd className="mono">{user.email}</dd></div>
                  <div><dt>Rol</dt><dd><span className="member-profile-pill">{user.role}</span></dd></div>
                  <div><dt>Alta de cuenta</dt><dd>{fmtDate(user.created_at)}</dd></div>
                  <div><dt>Último acceso</dt><dd>{fmtDateTime(user.last_login_at)}</dd></div>
                </dl>
                <div className="member-profile-actions">
                  <button className="member-home-logout" onClick={() => setEditing('name')}>Editar nombre</button>
                </div>
              </>
            )}
          </section>

          {/* ── Datos de socio — fuente: app_aikikan ── */}
          <section className="member-profile-card member-profile-card-spacer">
            <div className="member-profile-section-title">Datos de socio</div>
            {editing === 'member' ? (
              <form onSubmit={saveMember} className="member-profile-form">
                <div className="member-profile-field">
                  <label className="member-profile-label">Número de federado</label>
                  <input
                    className="member-profile-input"
                    value={memberForm.memberNumber}
                    onChange={(e) => setMemberForm({ ...memberForm, memberNumber: e.target.value })}
                    maxLength={64}
                  />
                </div>
                <div className="member-profile-field">
                  <label className="member-profile-label">Alta como socio</label>
                  <input
                    type="date"
                    className="member-profile-input"
                    value={memberForm.memberSince}
                    onChange={(e) => setMemberForm({ ...memberForm, memberSince: e.target.value })}
                  />
                </div>
                <div className="member-profile-field">
                  <label className="member-profile-label">Grado</label>
                  <select
                    className="member-profile-input"
                    value={memberForm.aikidoGrade}
                    onChange={(e) => setMemberForm({ ...memberForm, aikidoGrade: e.target.value })}
                  >
                    <option value="">— sin definir —</option>
                    {Object.keys(GRADE_LABEL).map((k) => (
                      <option key={k} value={k}>{GRADE_LABEL[k]}</option>
                    ))}
                  </select>
                </div>
                <div className="member-profile-field">
                  <label className="member-profile-label">Dojo</label>
                  <input
                    className="member-profile-input"
                    value={memberForm.dojoName}
                    onChange={(e) => setMemberForm({ ...memberForm, dojoName: e.target.value })}
                    maxLength={128}
                  />
                </div>
                <div className="member-profile-actions">
                  <button type="button" className="member-home-logout" onClick={() => setEditing(null)} disabled={saving}>Cancelar</button>
                  <button type="submit" className="member-home-logout member-profile-primary" disabled={saving}>
                    {saving ? 'Guardando…' : 'Guardar'}
                  </button>
                </div>
              </form>
            ) : (
              <>
                <dl className="member-profile-dl">
                  <div><dt>Número de federado</dt><dd>{member?.member_number ?? <em>sin definir</em>}</dd></div>
                  <div><dt>Alta como socio</dt><dd>{member?.member_since ? fmtDate(member.member_since) : <em>sin definir</em>}</dd></div>
                  <div><dt>Grado</dt><dd>{member?.aikido_grade ? (GRADE_LABEL[member.aikido_grade] ?? member.aikido_grade) : <em>sin definir</em>}</dd></div>
                  <div><dt>Dojo</dt><dd>{member?.dojo_name ?? <em>sin definir</em>}</dd></div>
                </dl>
                {savedAt && <p className="member-profile-saved">✓ Cambios guardados</p>}
                <div className="member-profile-actions">
                  <button className="member-home-logout" onClick={() => setEditing('member')}>
                    {member ? 'Editar datos de socio' : 'Completar perfil'}
                  </button>
                </div>
              </>
            )}
            <p className="member-profile-hint">
              Para cambiar tu contraseña, usa "He olvidado mi contraseña" desde la pantalla de acceso.
            </p>
          </section>
        </>
      )}
    </main>
  )
}
