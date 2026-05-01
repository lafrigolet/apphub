import { useEffect, useState } from 'react'
import { useApp } from '../context/AppContext'
import { api } from '../lib/api'

function statusBadge(status) {
  const map = {
    verified:  ['bg-okbg text-ok',         'Verificado'],
    pending:   ['bg-warnbg text-warn',     'Pendiente'],
    failed:    ['bg-dangerbg text-danger', 'Fallo'],
    suspended: ['bg-paper2 text-ink3',     'Suspendido'],
  }
  const [cls, label] = map[status] ?? ['bg-paper2 text-ink3', status]
  return <span className={`badge ${cls}`}>{label}</span>
}

// Self-contained domain authentication manager. Used by:
//   - views/tenant/Email.jsx        (owner/admin context, scopeQuery='')
//   - views/staff/TenantDetail.jsx  (staff impersonating, scopeQuery='?appId=…&tenantId=…')
//
// Props:
//   scopeQuery   '?appId=…&tenantId=…' for staff impersonation (default '')
//   canSuspend   show the Suspend button next to each domain (staff only)
//   compact      tighter layout inside a tab (no big page header)
export default function EmailDomainsManager({ scopeQuery = '', canSuspend = false, compact = false }) {
  const { toast } = useApp()
  const [items, setItems] = useState(null)
  const [domain, setDomain] = useState('')
  const [creating, setCreating] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [editing, setEditing] = useState(null)

  const baseUrl = '/api/notifications/email-domains'
  const join = (path = '') => `${baseUrl}${path}${scopeQuery}`

  function reload() {
    setItems(null)
    api.get(join())
      .then((r) => setItems(r?.data ?? []))
      .catch((err) => { setItems([]); toast(err.message ?? 'Error', 'danger') })
  }

  useEffect(() => { reload() /* eslint-disable-next-line */ }, [scopeQuery])

  async function createDomain(e) {
    e.preventDefault()
    if (!domain.trim()) return
    setCreating(true)
    try {
      await api.post(join(), { domain: domain.trim() })
      toast('Dominio añadido — publica los CNAMEs y pulsa "Verificar"')
      setDomain('')
      reload()
    } catch (err) { toast(err.message ?? 'No se pudo crear', 'danger') }
    finally { setCreating(false) }
  }

  async function verify(id) {
    setBusyId(id)
    try {
      const r = await api.post(join(`/${id}/verify`), {})
      const status = r?.data?.status
      if (status === 'verified') toast('Dominio verificado')
      else if (status === 'pending') toast('Aún no verificado — comprueba que los CNAMEs están publicados', 'warn')
      else toast('Verificación falló', 'danger')
      reload()
    } catch (err) { toast(err.message ?? 'Error', 'danger') }
    finally { setBusyId(null) }
  }

  async function suspend(id) {
    if (!window.confirm('¿Suspender este dominio? El tenant no podrá enviar correos desde él hasta reactivarlo.')) return
    setBusyId(id)
    try {
      await api.post(join(`/${id}/suspend`), {})
      toast('Dominio suspendido', 'warn')
      reload()
    } catch (err) { toast(err.message ?? 'Error', 'danger') }
    finally { setBusyId(null) }
  }

  async function remove(id) {
    if (!window.confirm('¿Eliminar este dominio? No podrás enviar correos desde él hasta volver a configurarlo.')) return
    setBusyId(id)
    try {
      await api.delete(join(`/${id}`))
      toast('Dominio eliminado')
      reload()
    } catch (err) { toast(err.message ?? 'Error', 'danger') }
    finally { setBusyId(null) }
  }

  async function saveDefaults() {
    if (!editing) return
    setBusyId(editing.id)
    try {
      await api.patch(join(`/${editing.id}`), {
        defaultFromLocal: editing.defaultFromLocal?.trim() || null,
        defaultFromName:  editing.defaultFromName?.trim()  || null,
        replyToAddress:   editing.replyToAddress?.trim()   || null,
      })
      toast('Guardado')
      setEditing(null)
      reload()
    } catch (err) { toast(err.message ?? 'Error', 'danger') }
    finally { setBusyId(null) }
  }

  function copy(text) {
    navigator.clipboard.writeText(text).then(() => toast('Copiado'))
  }

  return (
    <div className={compact ? '' : 'p-8 max-w-4xl fade-up'}>
      {!compact && (
        <div className="mb-8">
          <div className="text-[12px] uppercase tracking-[0.18em] text-ink3 mb-2">Tenant / Email</div>
          <h1 className="font-display text-[44px] leading-none tracking-tight">
            <span className="italic font-normal">Dominios</span> de envío
          </h1>
          <p className="text-ink3 mt-3 max-w-2xl">
            Configura los dominios desde los que el tenant enviará correos.
            La plataforma firma cada email con DKIM del dominio para que llegue
            autenticado al destinatario.
          </p>
        </div>
      )}

      <form onSubmit={createDomain} className={`bg-white border border-line rounded-xl shadow-card ${compact ? 'p-4 mb-4' : 'p-6 mb-8'}`}>
        <div className={`font-display ${compact ? 'text-[16px]' : 'text-[20px]'} mb-1`}>Añadir dominio</div>
        <div className="text-xs text-ink3 mb-4">Introduce el dominio raíz (sin <code className="font-mono">www</code>, sin <code className="font-mono">@</code>).</div>
        <div className="flex gap-3">
          <input
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="bastardo.com"
            className="input flex-1 font-mono text-[14px]"
            disabled={creating}
          />
          <button type="submit" className="btn btn-primary" disabled={creating || !domain.trim()}>
            {creating ? 'Añadiendo…' : 'Añadir'}
          </button>
        </div>
      </form>

      {items === null
        ? <div className="p-10 text-center text-ink3">Cargando…</div>
        : items.length === 0
          ? <div className="p-10 dotted text-center text-ink3 text-sm">No hay dominios configurados todavía.</div>
          : (
            <div className="space-y-4">
              {items.map((d) => {
                const dns = Array.isArray(d.dns_records) ? d.dns_records : []
                const isEditing = editing?.id === d.id
                return (
                  <div key={d.id} className="bg-white border border-line rounded-xl shadow-card">
                    <div className="px-5 py-4 border-b border-line flex items-center justify-between">
                      <div>
                        <div className={`font-display ${compact ? 'text-[16px]' : 'text-[20px]'} font-mono`}>{d.domain}</div>
                        <div className="text-xs text-ink3 mt-0.5">
                          Proveedor: {d.provider} · Última verificación: {d.last_checked_at ? new Date(d.last_checked_at).toLocaleString('es-ES') : '—'}
                        </div>
                      </div>
                      {statusBadge(d.status)}
                    </div>

                    {d.status !== 'verified' && d.status !== 'suspended' && (
                      <div className="px-5 py-4 border-b border-line">
                        <div className="text-[13px] text-ink2 mb-3">
                          Publica estos registros en el DNS de <code className="font-mono">{d.domain}</code>.
                          Cuando estén propagados, pulsa "Verificar".
                        </div>
                        <div className="bg-paper2 border border-line rounded-lg overflow-hidden">
                          <table className="w-full text-[12.5px] font-mono">
                            <thead className="bg-paper text-ink3">
                              <tr><th className="text-left p-2">Tipo</th><th className="text-left p-2">Host</th><th className="text-left p-2">Valor</th><th /></tr>
                            </thead>
                            <tbody>
                              {dns.map((r, i) => (
                                <tr key={i} className="border-t border-line">
                                  <td className="p-2 uppercase">{r.type}</td>
                                  <td className="p-2 break-all">{r.host}</td>
                                  <td className="p-2 break-all">{r.data}</td>
                                  <td className="p-2 text-right">
                                    <button onClick={() => copy(`${r.host}\t${r.type.toUpperCase()}\t${r.data}`)} className="btn btn-ghost btn-sm">Copiar</button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <div className="text-[12px] text-ink3 mt-3">
                          Recuerda añadir también <code className="font-mono">v=spf1 include:sendgrid.net ~all</code> al
                          registro SPF (TXT) de <code className="font-mono">{d.domain}</code> y, opcionalmente, una
                          política DMARC.
                        </div>
                      </div>
                    )}

                    {d.status === 'verified' && (
                      <div className="px-5 py-4 border-b border-line">
                        {!isEditing
                          ? (
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-[13px]">
                              <div>
                                <div className="text-[11px] uppercase tracking-[0.14em] text-ink3 mb-1">From por defecto</div>
                                <div className="font-mono">
                                  {d.default_from_local ? `${d.default_from_local}@${d.domain}` : <span className="text-ink3">—</span>}
                                </div>
                              </div>
                              <div>
                                <div className="text-[11px] uppercase tracking-[0.14em] text-ink3 mb-1">Nombre</div>
                                <div>{d.default_from_name || <span className="text-ink3">—</span>}</div>
                              </div>
                              <div>
                                <div className="text-[11px] uppercase tracking-[0.14em] text-ink3 mb-1">Reply-To</div>
                                <div className="font-mono">{d.reply_to_address || <span className="text-ink3">—</span>}</div>
                              </div>
                            </div>
                          )
                          : (
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                              <div>
                                <div className="label mb-1.5">From local part</div>
                                <div className="flex items-center">
                                  <input className="input rounded-r-none" value={editing.defaultFromLocal ?? ''} placeholder="noreply" onChange={(e) => setEditing({ ...editing, defaultFromLocal: e.target.value })} />
                                  <span className="px-3 py-2 bg-paper2 border border-l-0 border-line rounded-r-md text-ink3 text-[13px] font-mono">@{d.domain}</span>
                                </div>
                              </div>
                              <div>
                                <div className="label mb-1.5">Nombre del remitente</div>
                                <input className="input" value={editing.defaultFromName ?? ''} placeholder="Bastardo" onChange={(e) => setEditing({ ...editing, defaultFromName: e.target.value })} />
                              </div>
                              <div>
                                <div className="label mb-1.5">Reply-To (opcional)</div>
                                <input className="input font-mono text-[13px]" value={editing.replyToAddress ?? ''} placeholder={`hola@${d.domain}`} onChange={(e) => setEditing({ ...editing, replyToAddress: e.target.value })} />
                              </div>
                            </div>
                          )}
                      </div>
                    )}

                    {d.status === 'suspended' && (
                      <div className="px-5 py-4 border-b border-line bg-paper2 text-[13px] text-ink2">
                        Suspendido{d.suspend_reason ? <> — <em>{d.suspend_reason}</em></> : ''}.
                        El tenant no puede enviar desde este dominio hasta que sea reactivado.
                      </div>
                    )}

                    <div className="px-5 py-3 flex items-center justify-end gap-2">
                      {d.status !== 'verified' && d.status !== 'suspended' && (
                        <button onClick={() => verify(d.id)} disabled={busyId === d.id} className="btn btn-primary btn-sm">
                          {busyId === d.id ? 'Verificando…' : 'Verificar ahora'}
                        </button>
                      )}
                      {d.status === 'verified' && !isEditing && (
                        <button onClick={() => setEditing({
                          id: d.id,
                          defaultFromLocal: d.default_from_local ?? '',
                          defaultFromName:  d.default_from_name ?? '',
                          replyToAddress:   d.reply_to_address ?? '',
                        })} className="btn btn-ghost btn-sm">Editar defaults</button>
                      )}
                      {isEditing && (
                        <>
                          <button onClick={() => setEditing(null)} className="btn btn-ghost btn-sm">Cancelar</button>
                          <button onClick={saveDefaults} disabled={busyId === editing.id} className="btn btn-primary btn-sm">Guardar</button>
                        </>
                      )}
                      {canSuspend && d.status !== 'suspended' && (
                        <button onClick={() => suspend(d.id)} disabled={busyId === d.id} className="btn btn-ghost btn-sm text-warn">Suspender</button>
                      )}
                      <button onClick={() => remove(d.id)} disabled={busyId === d.id} className="btn btn-ghost btn-sm text-danger">Eliminar</button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
    </div>
  )
}
