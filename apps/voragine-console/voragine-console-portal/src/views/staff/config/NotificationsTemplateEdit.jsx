import { useEffect, useState } from 'react'
import { useApp } from '../../../context/AppContext'
import { api } from '../../../lib/api'

export default function NotificationsTemplateEdit() {
  const { toast, navigate, viewState } = useApp()
  const id = viewState?.templateId
  const [t, setT] = useState(null)
  const [preview, setPreview] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  function reload() {
    setLoading(true)
    api.get(`/api/notifications/admin/templates/${id}`)
      .then((r) => setT(r?.data))
      .catch((err) => { toast(err.message, 'danger'); navigate('config-notifications-templates') })
      .finally(() => setLoading(false))
  }

  useEffect(() => { if (id) reload() }, [id])

  async function save() {
    setSaving(true)
    try {
      await api.patch(`/api/notifications/admin/templates/${id}`, {
        subject: t.subject, body_text: t.body_text, body_html: t.body_html, variables: t.variables,
      })
      toast('Plantilla guardada')
      reload()
    } catch (err) { toast(err.message, 'danger') } finally { setSaving(false) }
  }

  async function doPreview() {
    try {
      const vars = Object.fromEntries((t.variables ?? []).map((v) => [v, `<${v}>`]))
      const r = await api.post(`/api/notifications/admin/templates/${id}/preview`, { vars })
      setPreview(r?.data)
    } catch (err) { toast(err.message, 'danger') }
  }

  if (loading || !t) return <div className="p-10 text-center text-ink3">Cargando…</div>

  return (
    <div className="p-8 max-w-4xl fade-up">
      <div className="mb-6">
        <button onClick={() => navigate('config-notifications-templates')} className="text-[12px] text-ink3 hover:text-ink">← Plantillas</button>
        <h1 className="font-display text-[36px] mt-2"><span className="italic font-normal">{t.key}</span></h1>
      </div>

      <div className="card p-6 space-y-5">
        <div>
          <label className="block text-[12px] uppercase tracking-[0.14em] text-ink3 mb-1">Subject</label>
          <input value={t.subject ?? ''} onChange={(e) => setT({ ...t, subject: e.target.value })} className="input w-full" />
        </div>

        <div>
          <label className="block text-[12px] uppercase tracking-[0.14em] text-ink3 mb-1">Body (text)</label>
          <textarea
            value={t.body_text ?? ''}
            onChange={(e) => setT({ ...t, body_text: e.target.value })}
            rows={10}
            className="textarea w-full font-mono text-[13px]"
          />
        </div>

        <div>
          <label className="block text-[12px] uppercase tracking-[0.14em] text-ink3 mb-1">Body (HTML, opcional)</label>
          <textarea
            value={t.body_html ?? ''}
            onChange={(e) => setT({ ...t, body_html: e.target.value })}
            rows={6}
            className="textarea w-full font-mono text-[13px]"
          />
        </div>

        <div>
          <label className="block text-[12px] uppercase tracking-[0.14em] text-ink3 mb-1">Variables disponibles</label>
          <div className="text-[12px] text-ink3">
            {(t.variables ?? []).map((v) => (
              <span key={v} className="inline-block mr-2 px-2 py-0.5 rounded bg-paper2 font-mono text-ink2">{`{{${v}}}`}</span>
            ))}
            <span className="ml-2">(usa estos placeholders en subject y body)</span>
          </div>
        </div>

        <div className="flex justify-between gap-3">
          <button onClick={doPreview} className="btn btn-ghost">Preview con datos mock</button>
          <button onClick={save} disabled={saving} className="btn btn-primary">{saving ? 'Guardando…' : 'Guardar'}</button>
        </div>

        {preview && (
          <div className="border-t border-line pt-5 mt-5">
            <h3 className="text-[14px] font-semibold mb-3">Preview</h3>
            <div className="text-[13px]"><span className="text-ink3">Subject:</span> {preview.subject}</div>
            <pre className="bg-paper2 p-3 mt-2 font-mono text-[12px] whitespace-pre-wrap">{preview.text}</pre>
          </div>
        )}
      </div>
    </div>
  )
}
