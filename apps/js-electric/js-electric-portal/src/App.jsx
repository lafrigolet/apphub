import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Landing       from './views/Landing.jsx'
import AdminLogin    from './views/admin/AdminLogin.jsx'
import AdminShell    from './views/admin/AdminShell.jsx'
import InquiriesList from './views/admin/InquiriesList.jsx'
import InquiryDetail from './views/admin/InquiryDetail.jsx'
import RequireAdmin  from './components/RequireAdmin.jsx'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route element={<RequireAdmin />}>
          <Route path="/admin" element={<AdminShell />}>
            <Route index element={<Navigate to="inquiries" replace />} />
            <Route path="inquiries"     element={<InquiriesList />} />
            <Route path="inquiries/:id" element={<InquiryDetail />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
