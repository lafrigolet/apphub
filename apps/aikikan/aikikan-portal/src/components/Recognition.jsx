const items = [
  'AIKIKAI FOUNDATION',
  'INTERNATIONAL AIKIDO FEDERATION',
  'EUROPEAN AIKIDO FEDERATION',
  'FNAAE · ESPAÑA',
  'HOMBU DOJO · TOKIO',
]
const doubled = [...items, ...items]

export default function Recognition() {
  return (
    <div id="recognition">
      <p className="recog-label">/ RECONOCIMIENTO INTERNACIONAL</p>
      <div className="recog-ticker-wrap">
        <div className="recog-ticker">
          {doubled.map((item, i) => (
            <span key={i}>
              <span className="recog-item">{item}</span>
              <span className="recog-sep"> · </span>
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
