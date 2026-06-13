import HeroStrip from './HeroStrip.jsx'
import HeroBento from './HeroBento.jsx'
import HeroCard from './HeroCard.jsx'

// Selector de variante del hero. La variante activa la controla Landing (estado
// + localStorage) y se cambia desde el control del menú (Header).
export default function Hero({ variant = 'strip' }) {
  if (variant === 'bento') return <HeroBento />
  if (variant === 'card') return <HeroCard />
  return <HeroStrip />
}
