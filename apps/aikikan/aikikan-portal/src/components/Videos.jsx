import { useEffect, useRef, useState } from 'react'
import { getIdentity, isAdminRole } from '../lib/auth.js'
import VideoModal, { deleteVideo } from './VideoModal.jsx'
import ConfirmModal from './ConfirmModal.jsx'

export default function Videos() {
  const [videos, setVideos]   = useState([])
  const [playing, setPlaying] = useState(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState(null)
  const trackRef = useRef(null)

  const identity = getIdentity()
  const isAdmin  = identity && isAdminRole(identity.role)

  function load() {
    fetch('/api/aikikan/videos')
      .then((r) => r.ok ? r.json() : [])
      .then((arr) => setVideos(Array.isArray(arr) ? arr : []))
      .catch(() => setVideos([]))
  }
  useEffect(load, [])

  // En modo lectura duplicamos para el carrusel ticker; en admin
  // mostramos cada vídeo una sola vez para que el trash actúe sobre
  // un único item.
  const allCards = isAdmin ? videos : [...videos, ...videos]

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

  async function confirmDelete() {
    if (!pendingDelete) return
    try { await deleteVideo(pendingDelete.id); load() }
    catch (err) { alert(err.message) }
  }

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
                <div key={`${v.id}-${idx}`} className={`vc-card${isPlaying ? ' playing' : ''}`} onClick={() => play(idx)}>
                  <div className="vc-thumb">
                    <img src={`https://img.youtube.com/vi/${v.youtube_id}/hqdefault.jpg`} alt={v.name ?? ''} />
                    <div className="vc-thumb-overlay"></div>
                    <div className="vc-play">
                      <div className="vc-play-btn">
                        <svg viewBox="0 0 24 24"><polygon points="5,3 19,12 5,21" /></svg>
                      </div>
                    </div>
                    <div className="vc-caption">
                      {v.label && <p className="vc-caption-label">{v.label}</p>}
                      {v.name  && <p className="vc-caption-name">{v.name}</p>}
                    </div>
                    {isAdmin && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setPendingDelete(v) }}
                        className="vc-trash"
                        title="Eliminar vídeo"
                        aria-label="Eliminar vídeo"
                      >×</button>
                    )}
                  </div>
                  <div className="vc-iframe-wrap">
                    {isPlaying && (
                      <iframe
                        title={v.name ?? ''}
                        src={`https://www.youtube.com/embed/${v.youtube_id}?autoplay=1&rel=0&modestbranding=1`}
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
        {isAdmin && (
          <div style={{ marginTop: '2rem', textAlign: 'center' }} className="reveal">
            <button onClick={() => setModalOpen(true)} className="btn-outline">
              <span className="slash">/</span> + Añadir vídeo
            </button>
          </div>
        )}
      </div>

      {modalOpen && (
        <VideoModal
          onClose={() => setModalOpen(false)}
          onCreated={() => { setModalOpen(false); load() }}
        />
      )}
      {pendingDelete && (
        <ConfirmModal
          title="Eliminar vídeo"
          message={`¿Eliminar el vídeo "${pendingDelete.name}"? Esta acción no se puede deshacer.`}
          confirmLabel="Eliminar"
          onConfirm={confirmDelete}
          onClose={() => setPendingDelete(null)}
        />
      )}
    </section>
  )
}
