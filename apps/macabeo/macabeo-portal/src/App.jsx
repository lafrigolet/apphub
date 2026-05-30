import { BrowserRouter, Routes, Route } from 'react-router-dom'
import RoleSelector  from './views/RoleSelector.jsx'
import Invitado      from './views/invitado/Invitado.jsx'
import Socio         from './views/socio/Socio.jsx'
import Cliente       from './views/cliente/Cliente.jsx'
import Administrador from './views/administrador/Administrador.jsx'
import GestorPedidos from './views/gestor-pedidos/GestorPedidos.jsx'
import Almacen       from './views/almacen/Almacen.jsx'
import Comprador     from './views/comprador/Comprador.jsx'
import Cajero        from './views/cajero/Cajero.jsx'
import Repartidor    from './views/repartidor/Repartidor.jsx'
import Proveedor     from './views/proveedor/Proveedor.jsx'
import Tesorero      from './views/tesorero/Tesorero.jsx'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/"               element={<RoleSelector />} />
        <Route path="/invitado"       element={<Invitado />} />
        <Route path="/socio"          element={<Socio />} />
        <Route path="/cliente"        element={<Cliente />} />
        <Route path="/admin"          element={<Administrador />} />
        <Route path="/gestor-pedidos" element={<GestorPedidos />} />
        <Route path="/almacen"        element={<Almacen />} />
        <Route path="/comprador"      element={<Comprador />} />
        <Route path="/cajero"         element={<Cajero />} />
        <Route path="/repartidor"     element={<Repartidor />} />
        <Route path="/proveedor"      element={<Proveedor />} />
        <Route path="/tesorero"       element={<Tesorero />} />
      </Routes>
    </BrowserRouter>
  )
}
