import { Routes, Route, Navigate } from 'react-router-dom'
import AppShell from './components/layout/AppShell'
import DashboardPage from './features/dashboard/DashboardPage'
import TransactionsPage from './features/transactions/TransactionsPage'
import PayoutsPage from './features/payouts/PayoutsPage'
import DisputesPage from './features/disputes/DisputesPage'
import SplitsPage from './features/splits/SplitsPage'
import MerchantsPage from './features/merchants/MerchantsPage'
import CheckoutPage from './features/checkout/CheckoutPage'
import OnboardingPage from './features/onboarding/OnboardingPage'

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard"    element={<DashboardPage />} />
        <Route path="transactions" element={<TransactionsPage />} />
        <Route path="payouts"      element={<PayoutsPage />} />
        <Route path="disputes"     element={<DisputesPage />} />
        <Route path="splits"       element={<SplitsPage />} />
        <Route path="merchants"    element={<MerchantsPage />} />
        <Route path="checkout"     element={<CheckoutPage />} />
        <Route path="onboarding"   element={<OnboardingPage />} />
      </Route>
    </Routes>
  )
}
