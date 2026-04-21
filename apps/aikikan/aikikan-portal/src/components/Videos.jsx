import { useState, useEffect, useRef } from 'react'

const videos = [
  { vid: 'eV3c0gMxPJI', label: 'Fundador', name: "Morihei Ueshiba — O'Sensei" },
  { vid: 'rVOhCBdVvNM', label: '8º Dan Shihan', name: 'Nobuyoshi Tamura' },
  { vid: 'UqbUK93kkUM', label: 'III Doshu', name: 'Moriteru Ueshiba — Kagamibiraki 2026' },
  { vid: 'qbW5frQI4dU', label: '6º Dan Aikikai', name: 'Malcolm Tiki Shewan — Principios de Aikido' },
  { vid: 'boQqqh5ssMM', label: '7º Dan Shihan', name: 'Stéphane Benedetti — Seminario' },
  { vid: '4DEGlGHTXnI', label: 'Mutokukai · Shihan', name: 'Benedetti — Técnica y espíritu' },
]
const allCards = [...videos, ...videos]

export default function Videos() {
  const [playing, setPlaying] = useState(null)
  const trackRef = useRef(null)

  const play = (idx) => {
    setPlaying(idx)
    if (trackRef.current) trackRef.current.style.animationPlayState = 'paused'
  }

  useEffect(() => {
    const onClick = e => {
      if (!e.target.closest('.vc-card')) {
        setPlaying(null)
        if (trackRef.current) trackRef.current.style.animationPlayState = ''
      }
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [])

  return (
    <section id="videos">
      <div className="section-label reveal"><span className="slash">/</span> Archivo Visual</div>
      <h2 className="section-title reveal">TÉCNICA<br />EN MOVIMIENTO</h2>

      <div className="carousel-outer">
        <div className="carousel-track-wrap">
          <div className="carousel-track" ref={trackRef}>
            {allCards.map((v, idx) => {
              const isPlaying = playing === idx
              return (
                <div key={idx} className={`vc-card${isPlaying ? ' playing' : ''}`} onClick={() => play(idx)}>
                  <div className="vc-thumb">
                    <img src={`https://img.youtube.com/vi/${v.vid}/hqdefault.jpg`} alt={v.name} />
                    <div className="vc-thumb-overlay"></div>
                    <div className="vc-play">
                      <div className="vc-play-btn">
                        <svg viewBox="0 0 24 24"><polygon points="5,3 19,12 5,21" /></svg>
                      </div>
                    </div>
                    <div className="vc-caption">
                      <p className="vc-caption-label">{v.label}</p>
                      <p className="vc-caption-name">{v.name}</p>
                    </div>
                  </div>
                  <div className="vc-iframe-wrap">
                    {isPlaying && (
                      <iframe
                        title={v.name}
                        src={`https://www.youtube.com/embed/${v.vid}?autoplay=1&rel=0&modestbranding=1`}
                        allow="autoplay; encrypted-media; picture-in-picture"
                        allowFullScreen
                      />
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
}
