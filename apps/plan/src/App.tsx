import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useUser } from './lib/auth'
import Layout from './components/Layout/Layout'
import Home from './pages/Home'
import Dashboard from './pages/Dashboard'
import SignInPage from './pages/SignIn'
import SignUpPage from './pages/SignUp'
import {
  TeamDashboard,
  TeamMembers,
  TeamSettings,
  AcceptInvite,
  AuditLogs,
} from './pages/Team'
import { Downloads } from './pages/Portal'
import { Pricing } from './pages/Pricing'
import { Privacy, Terms } from './pages/Legal'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn } = useUser()
  const location = useLocation()

  // Wait for the session to resolve before deciding.
  if (!isLoaded) return null

  if (!isSignedIn) {
    const redirect = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/sign-in?redirect=${redirect}`} replace />
  }

  return <>{children}</>
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="pricing" element={<Pricing />} />
        <Route path="privacy" element={<Privacy />} />
        <Route path="terms" element={<Terms />} />
        <Route path="sign-in/*" element={<SignInPage />} />
        <Route path="sign-up/*" element={<SignUpPage />} />
        <Route
          path="dashboard"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="team/:slug"
          element={
            <ProtectedRoute>
              <TeamDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="team/:slug/members"
          element={
            <ProtectedRoute>
              <TeamMembers />
            </ProtectedRoute>
          }
        />
        <Route
          path="team/:slug/settings"
          element={
            <ProtectedRoute>
              <TeamSettings />
            </ProtectedRoute>
          }
        />
        <Route
          path="team/:slug/audit-logs"
          element={
            <ProtectedRoute>
              <AuditLogs />
            </ProtectedRoute>
          }
        />
        <Route path="invite/:token" element={<AcceptInvite />} />
        <Route
          path="portal/downloads"
          element={
            <ProtectedRoute>
              <Downloads />
            </ProtectedRoute>
          }
        />
      </Route>
    </Routes>
  )
}

export default App
