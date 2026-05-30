// Build-time configuration for auth modes.
// SaaS vs standalone is now driven purely by BUILD_MODE (decoupled from any
// auth-provider key) so air-gapped/standalone builds never touch Supabase Auth.
export const BUILD_MODE = import.meta.env.VITE_BUILD_MODE || 'saas'
export const LICENSE_KEY = import.meta.env.VITE_LICENSE_KEY || ''
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || ''
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

export const isSaaSMode = (): boolean => BUILD_MODE === 'saas'
export const isStandaloneMode = (): boolean => BUILD_MODE === 'standalone'
