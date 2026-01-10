// ESCAPEARTIST AuthGate - wraps shared components with app-specific branding
import type { ReactNode } from 'react'
import {
  StandaloneAuthGate as SharedStandaloneAuthGate,
  SaaSAuthGate as SharedSaaSAuthGate,
} from '@escapesuite/shared/auth'

const APP_NAME = 'ESCAPEARTIST'

// ESCAPEARTIST logo - video camera icon
const ArtistLogo = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: '100%', height: '100%' }}>
    <polygon points="23 7 16 12 23 17 23 7" />
    <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
  </svg>
)

interface AuthGateProps {
  children: ReactNode
}

export function StandaloneAuthGate({ children }: AuthGateProps) {
  return (
    <SharedStandaloneAuthGate appName={APP_NAME} logo={ArtistLogo} product="artist">
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
      logo={ArtistLogo}
    >
      {children}
    </SharedSaaSAuthGate>
  )
}
