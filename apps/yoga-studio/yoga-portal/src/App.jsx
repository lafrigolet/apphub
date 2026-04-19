import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './context/AuthContext.jsx'
import { ToastProvider } from './components/ui/ToastProvider.jsx'
import LandingPage from './pages/LandingPage.jsx'
import AppShell from './components/layout/AppShell.jsx'
import AlumnoDashboard from './features/dashboard/AlumnoDashboard.jsx'
import InstructorDashboard from './features/dashboard/InstructorDashboard.jsx'
import AdminDashboard from './features/dashboard/AdminDashboard.jsx'
import BookingsPage from './features/bookings/BookingsPage.jsx'
import BonusPage from './features/bonuses/BonusPage.jsx'
import ProfilePage from './features/profile/ProfilePage.jsx'
import CalendarPage from './features/calendar/CalendarPage.jsx'
import InstructorClassesPage from './features/instructor/InstructorClassesPage.jsx'
import AttendancePage from './features/instructor/AttendancePage.jsx'
import ClassesPage from './features/classes/ClassesPage.jsx'
import AdminBonusPage from './features/bonuses/AdminBonusPage.jsx'
import StudentsPage from './features/students/StudentsPage.jsx'
import ReportsPage from './features/reports/ReportsPage.jsx'
import BroadcastPage from './features/broadcast/BroadcastPage.jsx'

function PrivateRoute({ children, roles }) {
  const { user, loading } = useAuth()
  if (loading) return null
  if (!user) return <Navigate to="/" replace />
  if (roles && !roles.includes(user.role)) return <Navigate to="/app/dashboard" replace />
  return children
}

export default function App() {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-sand-50">
        <div className="w-10 h-10 border-4 border-sage-300 border-t-sage-600 rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <ToastProvider>
      <Routes>
        <Route path="/" element={user ? <Navigate to="/app/dashboard" replace /> : <LandingPage />} />
        <Route path="/app" element={<PrivateRoute><AppShell /></PrivateRoute>}>
          <Route path="dashboard" element={
            user?.role === 'admin' ? <AdminDashboard /> :
            user?.role === 'instructor' ? <InstructorDashboard /> :
            <AlumnoDashboard />
          } />
          {/* Alumno routes */}
          <Route path="calendar" element={<PrivateRoute roles={['alumno', 'admin']}><CalendarPage /></PrivateRoute>} />
          <Route path="bookings" element={<PrivateRoute roles={['alumno', 'admin']}><BookingsPage /></PrivateRoute>} />
          <Route path="bonuses" element={<PrivateRoute roles={['alumno', 'admin']}><BonusPage /></PrivateRoute>} />
          <Route path="profile" element={<ProfilePage />} />
          {/* Instructor routes */}
          <Route path="my-classes" element={<PrivateRoute roles={['instructor']}><InstructorClassesPage /></PrivateRoute>} />
          <Route path="attendance" element={<PrivateRoute roles={['instructor']}><AttendancePage /></PrivateRoute>} />
          {/* Admin routes */}
          <Route path="classes" element={<PrivateRoute roles={['admin']}><ClassesPage /></PrivateRoute>} />
          <Route path="students" element={<PrivateRoute roles={['admin']}><StudentsPage /></PrivateRoute>} />
          <Route path="admin-bonuses" element={<PrivateRoute roles={['admin']}><AdminBonusPage /></PrivateRoute>} />
          <Route path="reports" element={<PrivateRoute roles={['admin']}><ReportsPage /></PrivateRoute>} />
          <Route path="broadcast" element={<PrivateRoute roles={['admin']}><BroadcastPage /></PrivateRoute>} />
          <Route index element={<Navigate to="dashboard" replace />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ToastProvider>
  )
}
