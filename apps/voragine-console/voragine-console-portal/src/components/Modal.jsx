import { useApp } from '../context/AppContext'

export default function ModalContainer() {
  const { modal, closeModal } = useApp()
  if (!modal) return null
  const w = modal.size === 'lg' ? 'max-w-2xl' : modal.size === 'sm' ? 'max-w-sm' : 'max-w-md'
  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto py-16">
      <div className="absolute inset-0 backdrop" onClick={closeModal} />
      <div className={`relative bg-white rounded-2xl shadow-pop border border-line w-full ${w} mx-4 fade-up`}>
        {modal.content}
      </div>
    </div>
  )
}
