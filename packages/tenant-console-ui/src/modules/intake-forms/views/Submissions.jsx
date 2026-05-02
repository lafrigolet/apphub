import { api } from '../../../shell/lib/api'
import { useApp } from '../../../shell/lib/context'
import { useFetch, PageHeader, Table } from '../../../shell/lib/list-helpers'

export default function Submissions() {
  const { toast } = useApp()
  const [data, { loading, error }] = useFetch(() => api.get('/api/intake-forms/templates'))

  if (loading) return <div className="p-10 text-center text-ink3">Cargando…</div>
  if (error)   return <div className="p-10 text-center text-danger">Error: {error}</div>

  const templates = data?.data ?? data ?? []

  async function download(id) {
    try {
      // Static endpoint — the API streams a PDF for the submission.
      window.open(`/api/intake-forms/submissions/${id}/pdf`, '_blank', 'noopener')
    } catch (e) { toast(e.message, 'danger') }
  }

  return (
    <div className="p-8 max-w-6xl fade-up">
      <PageHeader kicker="Operaciones" title="Formularios de admisión" subtitle="Plantillas activas y borradores. Las submissions se descargan como PDF cuando el cliente las firma." />
      <Table
        cols={[
          { key: 'name',      label: 'Plantilla' },
          { key: 'version',   label: 'Versión' },
          { key: 'state',     label: 'Estado', render: (r) => r.published_version ? `v${r.published_version} publicada` : 'Borrador' },
          { key: 'updated',   label: 'Actualizada', render: (r) => r.updated_at?.slice(0, 10) },
        ]}
        rows={templates}
        empty={{ title: 'Sin plantillas', hint: 'Crea una desde la API o desde el front del cliente.' }}
      />
    </div>
  )
}
