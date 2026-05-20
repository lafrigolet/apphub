export default function Poem({ text, author, source }) {
  return (
    <div className="poem">
      <div className="poem-text">{text}</div>
      <div className="poem-attr">
        {author}
        {source && <small>— {source}</small>}
      </div>
    </div>
  )
}
