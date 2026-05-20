import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useToast } from '../components/Toast'
import { MapMock } from '../components/svg/Illustrations'
import { leads, donations } from '../lib/api'

const PUBLIC_BASE =
  typeof window !== 'undefined' ? window.location.origin : 'http://aulavera.hulkstein.local:8080'

export default function Contacto() {
  const showToast = useToast()
  const formRef = useRef(null)
  const donarRef = useRef(null)
  const location = useLocation()
  const [donating, setDonating] = useState(null) // 'one_shot' | 'recurring_monthly' | null
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (location.pathname === '/donar' && donarRef.current) {
      donarRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [location.pathname])

  const onSubmit = async (e) => {
    e.preventDefault()
    const form = e.currentTarget
    const data = new FormData(form)
    setSubmitting(true)
    try {
      await leads.create({
        contactName: data.get('nm'),
        email:       data.get('em'),
        message:     `${data.get('as') ?? ''}\n\n${data.get('ms') ?? ''}`.trim(),
        source:      'aulavera/contacto',
      })
      showToast('Mensaje recibido 🌿 Te respondemos en 48 h.')
      formRef.current?.reset()
    } catch (err) {
      showToast(`No se pudo enviar: ${err.message}`)
    } finally {
      setSubmitting(false)
    }
  }

  const onDonate = async (kind) => {
    setDonating(kind)
    try {
      // V1 — para arrancar Stripe necesitamos un email mínimo. Usamos un
      // prompt simple. Cuando haya formulario completo (NIF, dirección,
      // certificado fiscal opt-in) se reemplaza por modal dedicado.
      const email = window.prompt('Tu email para el recibo:')
      if (!email) { setDonating(null); return }
      const amount = kind === 'one_shot' ? 2500 : 1000
      const { data } = await donations.checkout({
        amountCents: amount,
        donorEmail:  email,
        kind,
        successUrl:  `${PUBLIC_BASE}/donar?ok=1`,
        cancelUrl:   `${PUBLIC_BASE}/donar?cancel=1`,
      })
      if (data?.sessionUrl) {
        window.location.href = data.sessionUrl
      } else {
        showToast('Gracias 💛 — checkout iniciado.')
      }
    } catch (err) {
      showToast(`No se pudo iniciar el pago: ${err.message}`)
    } finally {
      setDonating(null)
    }
  }

  return (
    <>
      <header className="page-header">
        <span className="eyebrow">Contacto &amp; donaciones</span>
        <h1>Escríbenos, <em>apóyanos</em>,<br />o ven a visitarnos.</h1>
        <p className="page-lead">
          Puedes hacernos llegar una propuesta, reservar tu sitio en una actividad o sumarte
          como donante o socio recurrente — cada gesto cuenta.
        </p>
      </header>

      <section className="section section-narrow" id="donar" ref={donarRef}>
        <h2 style={{ marginBottom: 32 }}>Donar al proyecto</h2>

        <div className="donate-grid">
          <div className="donate-card">
            <h3>Donación puntual</h3>
            <p style={{ color: 'var(--ink-soft)', marginBottom: 0 }}>Una contribución única, cuando puedas.</p>
            <div className="price">25 €<small> · sugerida</small></div>
            <ul>
              <li>Certificado fiscal para tu declaración</li>
              <li>Boletín trimestral del proyecto</li>
              <li>Acceso a fotos de los talleres</li>
            </ul>
            <button className="btn btn-ghost donate-btn" disabled={donating !== null} onClick={() => onDonate('one_shot')}>
              {donating === 'one_shot' ? 'Iniciando…' : 'Donar una vez →'}
            </button>
          </div>
          <div className="donate-card featured">
            <span className="ribbon">favorita</span>
            <h3>Hazte socio/a · cuota mensual</h3>
            <p className="featured-text" style={{ marginBottom: 0 }}>Apoyo recurrente, la forma más estable de cuidar el proyecto.</p>
            <div className="price">10 €<small> · al mes</small></div>
            <ul>
              <li>Todo lo anterior</li>
              <li>Acceso al <strong>Área privada</strong> con vídeos y recursos</li>
              <li>Plaza preferente en convivencias</li>
              <li>Modifica o cancela cuando quieras</li>
            </ul>
            <button className="btn btn-terra donate-btn" disabled={donating !== null} onClick={() => onDonate('recurring_monthly')}>
              {donating === 'recurring_monthly' ? 'Iniciando…' : 'Hacerme socio/a →'}
            </button>
          </div>
        </div>

        <div className="fiscal-info">
          <div className="icon">€</div>
          <div>
            <h4>Tu donación desgrava — somos Fundación.</h4>
            <p>
              Las donaciones a la Fundación AulaVera tienen deducción fiscal según la Ley 49/2002.
              Personas físicas:
              <span className="perc">80%</span> hasta 250 € y
              <span className="perc">40%</span> sobre el resto (45% si donaste durante 3 años seguidos).
              Personas jurídicas:
              <span className="perc">40%</span> con un máximo del 10% de la base imponible.
            </p>
          </div>
        </div>

        <h2 style={{ marginBottom: 24 }}>Escríbenos</h2>
        <div className="contact-grid">
          <form ref={formRef} className="form" onSubmit={onSubmit}>
            <div className="form-row">
              <div className="field">
                <label htmlFor="nm">Tu nombre</label>
                <input id="nm" name="nm" type="text" placeholder="Daniel et al." required />
              </div>
              <div className="field">
                <label htmlFor="em">Tu email</label>
                <input id="em" name="em" type="email" placeholder="tu@correo.com" required />
              </div>
            </div>
            <div className="field">
              <label htmlFor="as">Asunto</label>
              <select id="as" name="as" defaultValue="Información general">
                <option>Información general</option>
                <option>Quiero apuntarme a una actividad</option>
                <option>Soy investigador/a — convenio I+D</option>
                <option>Quiero proponer una colaboración</option>
                <option>Soy artista local</option>
                <option>Voluntariado</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="ms">Tu mensaje</label>
              <textarea id="ms" name="ms" placeholder="Cuéntanos qué te trae por aquí…" />
            </div>
            <label className="check">
              <input type="checkbox" required />
              <span>He leído y acepto la <a href="#" style={{ color: 'var(--terra)' }}>política de privacidad</a>. Mis datos se tratarán para responder a esta consulta.</span>
            </label>
            <button type="submit" className="btn btn-primary" style={{ justifySelf: 'start' }} disabled={submitting}>
              {submitting ? 'Enviando…' : 'Enviar mensaje →'}
            </button>
          </form>

          <aside className="contact-info">
            <h3>Donde nos encontrarás</h3>
            <p>Finca rústica en Losar de la Vera, junto a la residencia Servimayor.</p>
            <dl>
              <dt>Dirección postal</dt><dd>Por confirmar · Jarandilla de la Vera (Cáceres)</dd>
              <dt>Email</dt><dd>hola@aulavera.org</dd>
              <dt>Visitas</dt><dd>Con cita previa</dd>
              <dt>Comunidad</dt><dd>Cáceres · Extremadura</dd>
            </dl>
            <div className="map-mock"><MapMock /></div>
          </aside>
        </div>
      </section>
    </>
  )
}
