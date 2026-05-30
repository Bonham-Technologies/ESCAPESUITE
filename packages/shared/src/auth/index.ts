// Auth utilities for craft and artist apps
export {
  BUILD_MODE,
  LICENSE_KEY,
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  isSaaSMode,
  isStandaloneMode,
} from './config'

export { AuthContext, useAuth, type AuthState } from './context'

// Supabase Auth client + reactive session hook
export { getSupabase } from './supabaseClient'
export { useSupabaseUser, type SupabaseUserState } from './useSupabaseUser'

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
export { LicenseInputModal } from './LicenseInputModal'
export { ExpirationBanner } from './ExpirationBanner'
export {
  StandaloneAuthGate,
  SaaSAuthGate,
  type StandaloneAuthGateProps,
  type SaaSAuthGateProps,
} from './AuthGate'

// Machine identification for activation tracking
export { getMachineHash, clearMachineHash, getCachedMachineHash } from './machineHash'
