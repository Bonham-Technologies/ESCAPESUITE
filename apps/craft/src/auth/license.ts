// ESCAPECRAFT license validation
import { validateLicense as sharedValidateLicense, type License } from '@escapesuite/shared/auth'

// Re-export types
export { getLicenseInfo, type License } from '@escapesuite/shared/auth'

// Wrap validateLicense with craft-specific product
export function validateLicense(licenseKey: string): License | null {
  return sharedValidateLicense(licenseKey, 'craft')
}
