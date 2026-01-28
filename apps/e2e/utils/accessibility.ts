import { Page, Locator, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

/**
 * Accessibility testing utilities using axe-core
 */

export interface AxeViolation {
  id: string
  impact: 'minor' | 'moderate' | 'serious' | 'critical'
  description: string
  nodes: number
  help: string
  helpUrl: string
}

export interface AxeResult {
  violations: AxeViolation[]
  passes: number
  incomplete: number
}

/**
 * Run axe-core accessibility audit on a page
 * @param page - Playwright Page object
 * @param options - Optional axe configuration
 * @returns Accessibility audit results
 */
export async function runAxeCheck(
  page: Page,
  options?: {
    includeTags?: string[]
    excludeTags?: string[]
    disableRules?: string[]
    includeSelector?: string
    excludeSelector?: string
  }
): Promise<AxeResult> {
  let builder = new AxeBuilder({ page })

  if (options?.includeTags) {
    builder = builder.withTags(options.includeTags)
  }

  if (options?.disableRules) {
    builder = builder.disableRules(options.disableRules)
  }

  if (options?.includeSelector) {
    builder = builder.include(options.includeSelector)
  }

  if (options?.excludeSelector) {
    builder = builder.exclude(options.excludeSelector)
  }

  const results = await builder.analyze()

  return {
    violations: results.violations.map((v) => ({
      id: v.id,
      impact: v.impact as AxeViolation['impact'],
      description: v.description,
      nodes: v.nodes.length,
      help: v.help,
      helpUrl: v.helpUrl,
    })),
    passes: results.passes.length,
    incomplete: results.incomplete.length,
  }
}

/**
 * Assert no critical or serious accessibility violations
 */
export async function assertNoA11yViolations(
  page: Page,
  options?: {
    allowedImpact?: ('minor' | 'moderate')[]
    disableRules?: string[]
  }
): Promise<void> {
  const results = await runAxeCheck(page, { disableRules: options?.disableRules })

  const allowedImpact = options?.allowedImpact || []
  const criticalViolations = results.violations.filter(
    (v) => !allowedImpact.includes(v.impact as 'minor' | 'moderate')
  )

  if (criticalViolations.length > 0) {
    const violationSummary = criticalViolations
      .map((v) => `- [${v.impact}] ${v.id}: ${v.description} (${v.nodes} elements)`)
      .join('\n')

    throw new Error(
      `Accessibility violations found:\n${violationSummary}\n\nSee https://dequeuniversity.com for remediation guidance.`
    )
  }
}

/**
 * Get summary of accessibility violations
 */
export async function getAccessibilityViolations(page: Page): Promise<AxeViolation[]> {
  const results = await runAxeCheck(page)
  return results.violations
}

/**
 * Check keyboard navigation through interactive elements
 * @param page - Playwright Page object
 * @param elements - Array of selectors to navigate through
 */
export async function checkKeyboardNavigation(
  page: Page,
  elements: string[]
): Promise<{ success: boolean; failedElement?: string }> {
  for (const selector of elements) {
    const element = page.locator(selector).first()
    const isVisible = await element.isVisible().catch(() => false)

    if (!isVisible) {
      continue // Skip non-visible elements
    }

    // Try to focus the element
    await element.focus()
    const isFocused = await element.evaluate((el) => document.activeElement === el)

    if (!isFocused) {
      return { success: false, failedElement: selector }
    }
  }

  return { success: true }
}

/**
 * Validate focus order matches expected sequence
 * @param page - Playwright Page object
 */
export async function checkFocusOrder(page: Page): Promise<string[]> {
  const focusOrder: string[] = []

  // Tab through the page and record focus order
  for (let i = 0; i < 50; i++) {
    await page.keyboard.press('Tab')

    const focusedElement = await page.evaluate(() => {
      const el = document.activeElement
      if (!el || el === document.body) return null

      // Get a unique identifier for the element
      const id = el.id || el.getAttribute('data-testid') || el.tagName.toLowerCase()
      const text = el.textContent?.slice(0, 30).trim()
      return text ? `${id}:${text}` : id
    })

    if (!focusedElement) break
    if (focusOrder.includes(focusedElement)) break // Cycle detected
    focusOrder.push(focusedElement)
  }

  return focusOrder
}

/**
 * Check that all focusable elements have visible focus indicators
 */
export async function checkFocusVisibility(
  page: Page,
  selectors: string[]
): Promise<{ passed: string[]; failed: string[] }> {
  const passed: string[] = []
  const failed: string[] = []

  for (const selector of selectors) {
    const element = page.locator(selector).first()
    const isVisible = await element.isVisible().catch(() => false)

    if (!isVisible) continue

    await element.focus()

    // Check if element has visible focus styles
    const hasFocusIndicator = await element.evaluate((el) => {
      const styles = window.getComputedStyle(el)
      const outlineWidth = parseInt(styles.outlineWidth) || 0
      const boxShadow = styles.boxShadow !== 'none'
      const borderWidth = parseInt(styles.borderWidth) || 0

      // Check for common focus indicators
      return outlineWidth > 0 || boxShadow || borderWidth > 0
    })

    if (hasFocusIndicator) {
      passed.push(selector)
    } else {
      failed.push(selector)
    }
  }

  return { passed, failed }
}

/**
 * Check for ARIA live regions that announce dynamic content
 */
export async function checkAriaLiveRegions(page: Page): Promise<Locator[]> {
  const liveRegions = page.locator('[aria-live], [role="alert"], [role="status"]')
  return [liveRegions]
}

/**
 * Validate that all images have alt text
 */
export async function checkImageAltText(
  page: Page
): Promise<{ withAlt: number; withoutAlt: number; decorative: number }> {
  const images = await page.locator('img').all()

  let withAlt = 0
  let withoutAlt = 0
  let decorative = 0

  for (const img of images) {
    const alt = await img.getAttribute('alt')
    const role = await img.getAttribute('role')

    if (alt === '' || role === 'presentation') {
      decorative++
    } else if (alt) {
      withAlt++
    } else {
      withoutAlt++
    }
  }

  return { withAlt, withoutAlt, decorative }
}

/**
 * Check heading hierarchy is valid (h1 -> h2 -> h3, etc.)
 */
export async function checkHeadingHierarchy(
  page: Page
): Promise<{ valid: boolean; headings: { level: number; text: string }[]; errors: string[] }> {
  const headings: { level: number; text: string }[] = []
  const errors: string[] = []

  for (let level = 1; level <= 6; level++) {
    const elements = await page.locator(`h${level}`).all()
    for (const el of elements) {
      const text = (await el.textContent()) || ''
      headings.push({ level, text: text.slice(0, 50).trim() })
    }
  }

  // Sort by DOM order
  headings.sort((a, b) => a.level - b.level)

  // Check for skipped levels
  let lastLevel = 0
  for (const heading of headings) {
    if (heading.level > lastLevel + 1 && lastLevel > 0) {
      errors.push(`Skipped heading level: h${lastLevel} to h${heading.level}`)
    }
    lastLevel = heading.level
  }

  // Check for multiple h1s
  const h1Count = headings.filter((h) => h.level === 1).length
  if (h1Count > 1) {
    errors.push(`Multiple h1 elements found: ${h1Count}`)
  }

  return { valid: errors.length === 0, headings, errors }
}

/**
 * Check that form fields have associated labels
 */
export async function checkFormLabels(
  page: Page
): Promise<{ labeled: number; unlabeled: string[] }> {
  const inputs = await page.locator('input, select, textarea').all()
  let labeled = 0
  const unlabeled: string[] = []

  for (const input of inputs) {
    const type = await input.getAttribute('type')
    // Skip hidden inputs
    if (type === 'hidden') continue

    const id = await input.getAttribute('id')
    const ariaLabel = await input.getAttribute('aria-label')
    const ariaLabelledby = await input.getAttribute('aria-labelledby')
    const placeholder = await input.getAttribute('placeholder')

    // Check for label association
    let hasLabel = false

    if (ariaLabel || ariaLabelledby) {
      hasLabel = true
    } else if (id) {
      const label = await page.locator(`label[for="${id}"]`).count()
      hasLabel = label > 0
    }

    // Check for parent label
    if (!hasLabel) {
      const parentLabel = await input.evaluate((el) => el.closest('label') !== null)
      hasLabel = parentLabel
    }

    if (hasLabel) {
      labeled++
    } else {
      const identifier = id || placeholder || type || 'unknown'
      unlabeled.push(identifier)
    }
  }

  return { labeled, unlabeled }
}

/**
 * Check color contrast of text elements
 * Note: This is a simplified check - axe-core handles this more thoroughly
 */
export async function checkColorContrast(page: Page): Promise<boolean> {
  const results = await runAxeCheck(page, {
    includeTags: ['wcag2aa'],
    disableRules: [], // Enable color-contrast rule
  })

  const contrastViolations = results.violations.filter((v) => v.id === 'color-contrast')
  return contrastViolations.length === 0
}

/**
 * Check that links have meaningful text (not "click here", "read more", etc.)
 */
export async function checkLinkText(
  page: Page
): Promise<{ meaningful: number; vague: string[] }> {
  const links = await page.locator('a').all()
  let meaningful = 0
  const vague: string[] = []

  const vaguePatterns = [
    /^click here$/i,
    /^here$/i,
    /^read more$/i,
    /^learn more$/i,
    /^more$/i,
    /^link$/i,
  ]

  for (const link of links) {
    const text = ((await link.textContent()) || '').trim()
    const ariaLabel = await link.getAttribute('aria-label')
    const effectiveText = ariaLabel || text

    if (!effectiveText) {
      vague.push('[empty link]')
      continue
    }

    const isVague = vaguePatterns.some((pattern) => pattern.test(effectiveText))
    if (isVague) {
      vague.push(effectiveText)
    } else {
      meaningful++
    }
  }

  return { meaningful, vague }
}

/**
 * Check that interactive elements have sufficient touch target size (44x44 minimum)
 */
export async function checkTouchTargetSize(
  page: Page
): Promise<{ adequate: number; tooSmall: string[] }> {
  const interactive = await page.locator('button, a, input, select, [role="button"]').all()
  let adequate = 0
  const tooSmall: string[] = []

  for (const element of interactive) {
    const isVisible = await element.isVisible().catch(() => false)
    if (!isVisible) continue

    const box = await element.boundingBox()
    if (!box) continue

    // WCAG 2.2 requires 44x44 minimum for touch targets
    if (box.width >= 44 && box.height >= 44) {
      adequate++
    } else {
      const text = ((await element.textContent()) || '').slice(0, 20).trim()
      const tag = await element.evaluate((el) => el.tagName.toLowerCase())
      tooSmall.push(`${tag}:${text} (${Math.round(box.width)}x${Math.round(box.height)})`)
    }
  }

  return { adequate, tooSmall }
}
