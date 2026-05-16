import { Routes, Route, Navigate } from 'react-router-dom'
import LandingView from './views/LandingView'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingView />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
