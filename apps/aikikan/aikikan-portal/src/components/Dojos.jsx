import { useEffect, useMemo, useState } from 'react'
import { getIdentity, isAdminRole } from '../lib/auth.js'
import { resolveTenantId } from '../lib/tenant.js'
import DojoModal, { deleteDojo } from './DojoModal.jsx'
import ConfirmModal from './ConfirmModal.jsx'

const APP_ID = 'aikikan'

export default function Dojos() {
  const [dojos, setDojos]       = useState([])
  const [query, setQuery]       = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState(null)

  const identity = getIdentity()
  const isAdmin  = identity && isAdminRole(identity.role)

  function load() {
    resolveTenantId(APP_ID)
      .then((tenantId) =>
        fetch(`/api/aikikan/dojos?tenantId=${encodeURIComponent(tenantId)}`),
      )
      .then((r) => r.ok ? r.json() : [])
      .then((arr) => setDojos(Array.isArray(arr) ? arr : []))
      .catch(() => setDojos([]))
  }
  useEffect(load, [])

  // Búsqueda — exactamente como antes: filtra por dojo / ciudad /
  // provincia / sensei. El admin también busca; los controles de borrado
  // operan sobre los items filtrados.
  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim()
    if (!q) return dojos
    return dojos.filter((d) =>
      (d.name     ?? '').toLowerCase().includes(q) ||
      (d.city     ?? '').toLowerCase().includes(q) ||
      (d.province ?? '').toLowerCase().includes(q) ||
      (d.sensei   ?? '').toLowerCase().includes(q),
    )
  }, [dojos, query])

  async function confirmDelete() {
    if (!pendingDelete) return
    try { await deleteDojo(pendingDelete.id); load() }
    catch (err) { alert(err.message) }
  }

  return (
    <section id="dojos">
      <div className="dojos-header reveal">
        <div>
          <div className="section-label"><span className="slash">/</span> Red de Dojos</div>
          <h2 className="section-title">LOS<br />DOJOS</h2>
        </div>
        <span className="mono" style={{ fontSize: '.75rem', letterSpacing: '.15em', color: 'rgba(9,9,8,.28)', paddingBottom: '.5rem' }}>
          [ {dojos.length} ]
        </span>
      </div>

      <div className="dojos-search reveal">
        <span className="dojos-search-icon"><span className="slash">/</span></span>
        <input
          type="text"
          className="dojos-search-input"
          placeholder="Buscar por dojo, ciudad, provincia o sensei…"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        {query && (
          <span className="dojos-search-count">
            {filtered.length} resultado{filtered.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {filtered.length > 0 ? (
        <div className="dojo-grid">
          {filtered.map((d) => (
            <div key={d.id} className="dojo-card">
              <p className="dojo-region">{d.province}</p>
              <h3 className="dojo-name">{d.name}</h3>
              <p className="dojo-city">{d.city}</p>
              {d.address && <p className="dojo-address">{d.address}</p>}
              {d.sensei  && <p className="dojo-sensei"><span className="slash">/</span> {d.sensei}</p>}
              <div className="dojo-contacts">
                {d.phone && <a href={`tel:${d.phone.replace(/\s/g,'')}`} className="dojo-contact-item">{d.phone}</a>}
                {d.email && <a href={`mailto:${d.email}`} className="dojo-contact-item">{d.email}</a>}
                {d.web   && <a href={`https://${d.web}`} target="_blank" rel="noreferrer" className="dojo-contact-item">{d.web}</a>}
              </div>
              {isAdmin && (
                <button
                  onClick={() => setPendingDelete(d)}
                  className="dojo-trash"
                  title="Eliminar dojo"
                  aria-label="Eliminar dojo"
                >×</button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="dojos-empty">/ {dojos.length === 0 ? 'Sin dojos publicados.' : `No se encontraron dojos para "${query}"`}</p>
      )}

      {isAdmin && (
        <div style={{ marginTop: '2rem', textAlign: 'center' }} className="reveal">
          <button onClick={() => setModalOpen(true)} className="btn-outline">
            <span className="slash">/</span> + Añadir dojo
          </button>
        </div>
      )}

      {modalOpen && (
        <DojoModal
          onClose={() => setModalOpen(false)}
          onCreated={() => { setModalOpen(false); load() }}
        />
      )}
      {pendingDelete && (
        <ConfirmModal
          title="Eliminar dojo"
          message={`¿Eliminar el dojo "${pendingDelete.name}"? Esta acción no se puede deshacer.`}
          confirmLabel="Eliminar"
          onConfirm={confirmDelete}
          onClose={() => setPendingDelete(null)}
        />
      )}
    </section>
  )
}
