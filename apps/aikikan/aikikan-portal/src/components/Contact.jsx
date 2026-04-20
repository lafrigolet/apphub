export default function Contact() {
  return (
    <section id="contacto">
      <div className="section-label reveal"><span className="slash">/</span> Contacto</div>
      <div className="contact-grid">
        <div className="reveal">
          <h2 className="section-title">HABLEMOS</h2>
          <div className="contact-big"><a href="mailto:secretaria@aikikan.es">SECRETARÍA</a></div>
        </div>
        <div className="reveal" style={{ paddingTop: '2rem' }}>
          <div style={{ marginBottom: '2.2rem' }}>
            <p className="detail-label">/ Dirección</p>
            <p className="detail-value">C/ Capitán Antoni Mena, 42<br />03201 Elche (Alicante) · España</p>
          </div>
          <div style={{ marginBottom: '2.2rem' }}>
            <p className="detail-label">/ Correo Electrónico</p>
            <p className="detail-value"><a href="mailto:secretaria@aikikan.es" style={{ color: 'var(--accent)', textDecoration: 'none' }}>secretaria@aikikan.es</a></p>
          </div>
          <div style={{ marginBottom: '2.2rem' }}>
            <p className="detail-label">/ Teléfono</p>
            <p className="detail-value"><a href="tel:+34672368699" style={{ color: 'rgba(9,9,8,.65)', textDecoration: 'none' }}>+34 672 368 699</a></p>
          </div>
          <div>
            <p className="detail-label">/ Redes Sociales</p>
            <div className="social-links">
              <a href="https://www.facebook.com/share/p/GtHbPdwKLbH69S3e/" target="_blank" rel="noreferrer"><span className="slash">/</span> Facebook</a>
              <a href="https://www.instagram.com/aikikan_espana" target="_blank" rel="noreferrer"><span className="slash">/</span> Instagram</a>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
