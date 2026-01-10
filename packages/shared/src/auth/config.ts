// Build-time configuration for auth modes
export const BUILD_MODE = import.meta.env.VITE_BUILD_MODE || 'saas'
export const LICENSE_KEY = import.meta.env.VITE_LICENSE_KEY || ''
export const CLERK_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || ''
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || ''
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

export const isSaaSMode = (): boolean => BUILD_MODE === 'saas' && !!CLERK_KEY
export const isStandaloneMode = (): boolean => BUILD_MODE === 'standalone' || !CLERK_KEY
