import { BrowserRouter, Routes, Route } from 'react-router-dom'
import RoleSelector from './views/RoleSelector.jsx'
import Emisor from './views/emisor/Emisor.jsx'
import Asesoria from './views/asesoria/Asesoria.jsx'
import Desarrollador from './views/desarrollador/Desarrollador.jsx'
import Administrador from './views/administrador/Administrador.jsx'
import Receptor from './views/receptor/Receptor.jsx'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<RoleSelector />} />
        <Route path="/emisor" element={<Emisor />} />
        <Route path="/asesoria" element={<Asesoria />} />
        <Route path="/desarrollador" element={<Desarrollador />} />
        <Route path="/administrador" element={<Administrador />} />
        <Route path="/receptor" element={<Receptor />} />
      </Routes>
    </BrowserRouter>
  )
}
