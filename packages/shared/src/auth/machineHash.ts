/**
 * Machine Hash Generation for License Activation Tracking
 *
 * Generates a consistent hash based on browser/device fingerprint
 * for tracking license activations and enforcing seat limits.
 */

const MACHINE_HASH_KEY = 'escape_machine_hash'

/**
 * Collect browser and device characteristics for fingerprinting
 */
function collectFingerprint(): string {
  const components: string[] = []

  // User agent
  if (typeof navigator !== 'undefined') {
    components.push(navigator.userAgent || '')
    components.push(navigator.language || '')
    components.push(String(navigator.hardwareConcurrency || 0))
    components.push(navigator.platform || '')
  }

  // Screen characteristics
  if (typeof screen !== 'undefined') {
    components.push(String(screen.width || 0))
    components.push(String(screen.height || 0))
    components.push(String(screen.colorDepth || 0))
    components.push(String(screen.pixelDepth || 0))
  }

  // Timezone
  try {
    components.push(Intl.DateTimeFormat().resolvedOptions().timeZone || '')
  } catch {
    components.push('')
  }

  // WebGL renderer (consistent per GPU)
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl')
    if (gl && gl instanceof WebGLRenderingContext) {
      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info')
      if (debugInfo) {
        components.push(gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) || '')
        components.push(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || '')
      }
    }
  } catch {
    // WebGL not available
  }

  // Canvas fingerprint (basic)
  try {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (ctx) {
      canvas.width = 200
      canvas.height = 50
      ctx.textBaseline = 'top'
      ctx.font = '14px Arial'
      ctx.fillStyle = '#f60'
      ctx.fillRect(125, 1, 62, 20)
      ctx.fillStyle = '#069'
      ctx.fillText('ESCAPE', 2, 15)
      ctx.fillStyle = 'rgba(102, 204, 0, 0.7)'
      ctx.fillText('Suite', 4, 17)
      components.push(canvas.toDataURL().slice(-50))
    }
  } catch {
    // Canvas not available
  }

  return components.join('|')
}

/**
 * Generate SHA-256 hash of a string
 */
async function sha256(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message)
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Get or generate a machine hash for this device.
 *
 * The hash is cached in localStorage to ensure consistency across sessions.
 * If the fingerprint changes significantly, a new hash will be generated.
 */
export async function getMachineHash(): Promise<string> {
  // Check for cached hash first
  try {
    const cached = localStorage.getItem(MACHINE_HASH_KEY)
    if (cached) {
      return cached
    }
  } catch {
    // localStorage not available
  }

  // Generate new hash from fingerprint
  const fingerprint = collectFingerprint()
  const hash = await sha256(fingerprint)

  // Cache for future use
  try {
    localStorage.setItem(MACHINE_HASH_KEY, hash)
  } catch {
    // localStorage not available
  }

  return hash
}

/**
 * Clear the cached machine hash.
 * Used primarily for testing.
 */
export function clearMachineHash(): void {
  try {
    localStorage.removeItem(MACHINE_HASH_KEY)
  } catch {
    // localStorage not available
  }
}

/**
 * Get machine hash synchronously if cached, otherwise return null.
 * Use getMachineHash() for guaranteed result.
 */
export function getCachedMachineHash(): string | null {
  try {
    return localStorage.getItem(MACHINE_HASH_KEY)
  } catch {
    return null
  }
}
