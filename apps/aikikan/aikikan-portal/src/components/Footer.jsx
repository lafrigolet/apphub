import { useState } from 'react'
import LegalModal from './LegalModal.jsx'
import { PRIVACY_CONTENT, LEGAL_NOTICE_CONTENT, COOKIES_CONTENT } from './legalContent.jsx'

// Pantalla actual del modal: 'privacy' | 'legal' | 'cookies' | null.
// Click en cada link abre su modal en lugar de navegar a la URL externa
// (antes apuntaban a aikikan.es/privacy, /avisolegal, /legal/cookies-policy).
const SCREENS = {
  privacy: { title: 'Política de privacidad',  body: PRIVACY_CONTENT      },
  legal:   { title: 'Aviso legal',             body: LEGAL_NOTICE_CONTENT },
  cookies: { title: 'Política de cookies',     body: COOKIES_CONTENT      },
}

export default function Footer() {
  const [open, setOpen] = useState(null)

  return (
    <>
      <footer>
        <p className="footer-copy">© AIKIKAN ESPAÑA · MMXXVI · ELCHE, ALICANTE</p>
        <div className="footer-links">
          <button type="button" className="footer-link-btn" onClick={() => setOpen('privacy')}>Privacidad</button>
          <button type="button" className="footer-link-btn" onClick={() => setOpen('legal')}>Aviso Legal</button>
          <button type="button" className="footer-link-btn" onClick={() => setOpen('cookies')}>Cookies</button>
        </div>
      </footer>

      {open && (
        <LegalModal title={SCREENS[open].title} onClose={() => setOpen(null)}>
          {SCREENS[open].body}
        </LegalModal>
      )}
    </>
  )
}
