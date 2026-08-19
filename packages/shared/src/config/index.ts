// Build-time configuration.
// 'saas' (default) = hosted at escapesuite.io (Vercel Analytics enabled).
// 'standalone' = offline single-file build (no analytics, no network).
export const BUILD_MODE = import.meta.env.VITE_BUILD_MODE || 'saas'

export const isSaaSMode = (): boolean => BUILD_MODE === 'saas'
export const isStandaloneMode = (): boolean => BUILD_MODE === 'standalone'
