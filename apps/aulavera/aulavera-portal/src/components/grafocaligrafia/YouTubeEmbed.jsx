import { useState } from 'react'

// Facade click-to-load: pinta solo el thumbnail hasta que el usuario pulsa
// play — evita cargar ~20 iframes de YouTube en la página de recursos.
export default function YouTubeEmbed({ id, title }) {
  const [playing, setPlaying] = useState(false)

  return (
    <figure style={{ margin: 0 }}>
      {playing ? (
        <div className="yt-frame">
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${id}?autoplay=1`}
            title={title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      ) : (
        <button
          type="button"
          className="yt-facade"
          onClick={() => setPlaying(true)}
          aria-label={`Reproducir: ${title}`}
        >
          <img src={`https://img.youtube.com/vi/${id}/hqdefault.jpg`} alt="" loading="lazy" />
          <span className="yt-facade-play"><span>▶</span></span>
        </button>
      )}
      <figcaption className="video-title">{title}</figcaption>
    </figure>
  )
}
