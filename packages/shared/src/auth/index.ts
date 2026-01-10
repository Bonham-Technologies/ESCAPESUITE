// Auth utilities for craft and artist apps
export {
  BUILD_MODE,
  LICENSE_KEY,
  CLERK_KEY,
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  isSaaSMode,
  isStandaloneMode,
} from './config'

export { AuthContext, useAuth, type AuthState } from './context'

export {
  validateLicense,
  getLicenseInfo,
  type License,
  type ProductType,
} from './license'

export {
  getSubscription,
  isPaidUser,
  isTrialUser,
  type Subscription,
} from './subscription'

// Auth UI components
export { ErrorScreen } from './ErrorScreen'
export { LoadingScreen } from './LoadingScreen'
export {
  StandaloneAuthGate,
  SaaSAuthGate,
  type StandaloneAuthGateProps,
  type SaaSAuthGateProps,
} from './AuthGate'
