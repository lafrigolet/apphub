import { useEffect, useState } from 'react'

export default function CookiesBanner() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 1200)
    return () => clearTimeout(t)
  }, [])

  if (!visible) return null

  return (
    <div className="cookies">
      <p>
        <strong>Usamos cookies como pequeñas migas de pan</strong> — algunas son
        necesarias, otras nos ayudan a entender cómo se navega por la web. Puedes
        aceptarlas todas o configurarlas a tu gusto.
      </p>
      <div className="btns">
        <button onClick={() => setVisible(false)}>Configurar</button>
        <button className="primary" onClick={() => setVisible(false)}>Aceptar todas</button>
      </div>
    </div>
  )
}
