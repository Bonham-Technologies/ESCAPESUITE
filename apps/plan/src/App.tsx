import { Routes, Route } from 'react-router-dom'
import { SignedIn, SignedOut, RedirectToSignIn } from '@clerk/clerk-react'
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
} from './pages/Team'
import { Downloads } from './pages/Portal'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SignedIn>{children}</SignedIn>
      <SignedOut>
        <RedirectToSignIn />
      </SignedOut>
    </>
  )
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Home />} />
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
