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
