export default function MasterModal({ master, onClose }) {
  if (!master) return null

  return (
    <div id="master-modal" className="open">
      <div className="modal-backdrop" onClick={onClose}></div>
      <div className="modal-box">
        <div className="modal-portrait">
          <img src={master.img} alt={master.name} />
          <div className="modal-portrait-overlay"></div>
        </div>
        <div className="modal-content">
          <p className="modal-rank">{master.rank}</p>
          <h3 className="modal-name">{master.name}</h3>
          <p className="modal-years">{master.years}</p>
          <p className="modal-body">{master.body}</p>
          <blockquote className="modal-quote">{master.quote}</blockquote>
          <button className="modal-close" onClick={onClose}>/ CERRAR</button>
        </div>
      </div>
    </div>
  )
}
