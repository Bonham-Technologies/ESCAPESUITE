/**
 * Viewport configurations for responsive testing
 */

export interface ViewportConfig {
  name: string
  width: number
  height: number
}

/**
 * Standard breakpoints for responsive testing
 */
export const BREAKPOINTS = {
  desktop: 1200,
  laptop: 1024,
  tablet: 900,
  mobile: 640,
  mobileSmall: 480,
} as const

/**
 * Predefined viewport configurations
 */
export const VIEWPORTS: Record<string, ViewportConfig> = {
  desktop: {
    name: 'Desktop',
    width: 1440,
    height: 900,
  },
  laptop: {
    name: 'Laptop',
    width: 1024,
    height: 768,
  },
  tablet: {
    name: 'Tablet',
    width: 768,
    height: 1024,
  },
  tabletLandscape: {
    name: 'Tablet Landscape',
    width: 1024,
    height: 768,
  },
  mobile: {
    name: 'Mobile',
    width: 375,
    height: 667,
  },
  mobileLarge: {
    name: 'Mobile Large',
    width: 414,
    height: 896,
  },
  mobileSmall: {
    name: 'Mobile Small',
    width: 320,
    height: 568,
  },
} as const

/**
 * Viewport configurations for Playwright projects
 */
export const PLAYWRIGHT_VIEWPORTS = {
  mobile: {
    viewport: { width: 375, height: 667 },
    isMobile: true,
    hasTouch: true,
  },
  tablet: {
    viewport: { width: 768, height: 1024 },
    isMobile: false,
    hasTouch: true,
  },
  laptop: {
    viewport: { width: 1024, height: 768 },
    isMobile: false,
    hasTouch: false,
  },
} as const

/**
 * Get viewport by name
 */
export function getViewport(name: keyof typeof VIEWPORTS): ViewportConfig {
  return VIEWPORTS[name]
}

/**
 * Get all mobile viewports for testing
 */
export function getMobileViewports(): ViewportConfig[] {
  return [VIEWPORTS.mobile, VIEWPORTS.mobileLarge, VIEWPORTS.mobileSmall]
}

/**
 * Get all tablet viewports for testing
 */
export function getTabletViewports(): ViewportConfig[] {
  return [VIEWPORTS.tablet, VIEWPORTS.tabletLandscape]
}

/**
 * Get all desktop viewports for testing
 */
export function getDesktopViewports(): ViewportConfig[] {
  return [VIEWPORTS.desktop, VIEWPORTS.laptop]
}
