// ESCAPECRAFT AuthGate - wraps shared components with app-specific branding
import type { ReactNode } from 'react'
import {
  StandaloneAuthGate as SharedStandaloneAuthGate,
  SaaSAuthGate as SharedSaaSAuthGate,
} from '@escapesuite/shared/auth'

const APP_NAME = 'ESCAPECRAFT'

// ESCAPECRAFT logo - circular recording indicator
const CraftLogo = (
  <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: '100%', height: '100%' }}>
    <circle cx="12" cy="12" r="10" />
    <circle cx="12" cy="12" r="4" fill="var(--bg-primary, #0a0a0f)" />
  </svg>
)

interface AuthGateProps {
  children: ReactNode
}

export function StandaloneAuthGate({ children }: AuthGateProps) {
  return (
    <SharedStandaloneAuthGate appName={APP_NAME} logo={CraftLogo} product="craft">
      {children}
    </SharedStandaloneAuthGate>
  )
}

interface SaaSAuthGateProps {
  children: ReactNode
  userId: string | undefined
  isLoaded: boolean
}

export function SaaSAuthGate({ children, userId, isLoaded }: SaaSAuthGateProps) {
  return (
    <SharedSaaSAuthGate
      userId={userId}
      isLoaded={isLoaded}
      appName={APP_NAME}
      logo={CraftLogo}
    >
      {children}
    </SharedSaaSAuthGate>
  )
}
