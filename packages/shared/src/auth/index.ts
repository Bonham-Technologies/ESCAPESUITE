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
  validateLicenseAsync,
  getLicenseInfo,
  hasFeature,
  getLicenseStorageKey,
  saveLicense,
  loadLicense,
  clearLicense,
  type License,
  type ProductType,
  type LicenseTier,
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
