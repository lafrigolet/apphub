// Fila de recurso: artículo externo (abre en pestaña nueva) o material
// descargable (atributo download).
export default function RecursoLink({ tipo, title, href, meta, download = false }) {
  return (
    <div className="recurso-row">
      <span className="recurso-tipo">{tipo}</span>
      {download ? (
        <a href={href} download>{title}</a>
      ) : (
        <a href={href} target="_blank" rel="noopener noreferrer">{title}</a>
      )}
      {meta && <span className="recurso-meta">{meta}</span>}
    </div>
  )
}
