export default function About() {
  return (
    <section id="about">
      <div className="section-label reveal"><span className="slash">/</span> Asociación</div>
      <div className="about-grid">
        <div className="reveal">
          <h2 className="section-title">EL CAMINO<br />DEL AIKIDO</h2>
          <div className="about-body">
            <p>AIKIKAN España es la asociación nacional dedicada a la práctica y difusión del Aikido en todo el territorio español. Reunimos a practicantes, instructores y dojos bajo un mismo propósito: cultivar el arte marcial fundado por O'Sensei Morihei Ueshiba.</p>
            <p>Reconocidos por el Aikikai de Tokio, la International Aikido Federation y la European Aikido Federation, garantizamos los más altos estándares técnicos y éticos en la práctica del Aikido.</p>
          </div>
        </div>
        <div className="reveal">
          <div style={{ marginBottom: '3rem' }}>
            <p className="affil-label">/ RECONOCIMIENTO INTERNACIONAL</p>
            <div className="affil-list stagger">
              <div className="affil-item"><span className="slash">/</span> AIKIKAI · Tokio, Japón</div>
              <div className="affil-item"><span className="slash">/</span> IAF · International Aikido Federation</div>
              <div className="affil-item"><span className="slash">/</span> EAF · European Aikido Federation</div>
              <div className="affil-item"><span className="slash">/</span> FNAAE · Federación Nacional Española</div>
            </div>
          </div>
          <div>
            <p className="affil-label">/ ACTIVIDADES</p>
            <div className="affil-list stagger">
              <div className="affil-item"><span className="slash">/</span> Seminarios técnicos nacionales</div>
              <div className="affil-item"><span className="slash">/</span> Exámenes de grado oficiales</div>
              <div className="affil-item"><span className="slash">/</span> Renovación de licencias federativas</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
