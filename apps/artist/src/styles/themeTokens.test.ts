// ESCSUITE-421: the contrast the theme tokens promise, pinned numerically in
// both palettes so an edit to a token cannot reopen a failure silently.
//
// The light --text-muted was #718096, under 4.5:1 on every light surface but
// white, and --accent-primary as a focus border was 2.57:1 on the light
// --bg-secondary, under WCAG 1.4.11's 3:1. The e2e axe audit
// (apps/e2e/tests/accessibility/core.spec.ts) sees the text but not the focus
// borders: axe does not judge non-text contrast.
//
// This reads the stylesheet off disk rather than importing it: Vite hands a
// `.css` import to its CSS pipeline, and jsdom applies no stylesheets anyway.
// Vitest's cwd is the package root. Same approach as CRAFT's
// src/themeTokens.test.ts.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Comments are stripped first: the token comments name other tokens, and one
// written as `--name: ...` must not read as a declaration.
const css = readFileSync(join(process.cwd(), 'src/styles/index.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  ''
)

const DARK = ':root'
const LIGHT = ':root[data-theme="light"]'

/** The `--name: value` declarations directly inside one selector's block. */
function tokensIn(selector: string): Map<string, string> {
  const start = css.indexOf(`${selector} {`)
  expect(start, `no \`${selector}\` block in index.css`).toBeGreaterThan(-1)
  const block = css.slice(start, css.indexOf('\n}', start))
  const tokens = new Map<string, string>()
  for (const [, name, value] of block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    tokens.set(name, value.trim())
  }
  return tokens
}

/** A token's value in a palette; the light one inherits what it leaves out. */
function token(selector: string, name: string): string {
  const value = tokensIn(selector).get(name) ?? tokensIn(DARK).get(name)
  expect(value, `${selector} ${name}`).toMatch(/^#[0-9a-f]{6}$/i)
  return value as string
}

/** WCAG 2 relative luminance of a `#rrggbb` colour. */
function relativeLuminance(hex: string): number {
  const channel = (i: number) => {
    const s = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2)
}

/** WCAG 2 contrast ratio between two `#rrggbb` colours. */
function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x)
  return (lighter + 0.05) / (darker + 0.05)
}

const SURFACES = ['--bg-primary', '--bg-secondary', '--bg-tertiary', '--bg-hover']

describe('ESCAPEARTIST theme tokens', () => {
  it('checks its own arithmetic against a known pair', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5)
    expect(contrastRatio('#718096', '#f5f7fa')).toBeCloseTo(3.74, 2)
  })

  for (const palette of [DARK, LIGHT]) {
    it(`keeps --text-muted at 4.5:1 on every surface (${palette})`, () => {
      const muted = token(palette, '--text-muted')
      for (const surface of SURFACES) {
        expect(
          contrastRatio(muted, token(palette, surface)),
          `${palette} --text-muted on ${surface}`
        ).toBeGreaterThanOrEqual(4.5)
      }
    })

    it(`keeps --accent-text at 4.5:1 on every surface (${palette})`, () => {
      const accentText = token(palette, '--accent-text')
      for (const surface of SURFACES) {
        expect(
          contrastRatio(accentText, token(palette, surface)),
          `${palette} --accent-text on ${surface}`
        ).toBeGreaterThanOrEqual(4.5)
      }
    })

    it(`keeps --accent-ring at 3:1 on every surface (${palette})`, () => {
      const ring = token(palette, '--accent-ring')
      for (const surface of SURFACES) {
        expect(
          contrastRatio(ring, token(palette, surface)),
          `${palette} --accent-ring on ${surface}`
        ).toBeGreaterThanOrEqual(3)
      }
    })

    it(`keeps --accent-on-fill at 4.5:1 on the --accent-primary fill (${palette})`, () => {
      expect(
        contrastRatio(token(palette, '--accent-on-fill'), token(palette, '--accent-primary'))
      ).toBeGreaterThanOrEqual(4.5)
    })
  }

  it('keeps the light --text-muted lighter than --text-secondary, so the two still read as two', () => {
    const white = token(LIGHT, '--bg-primary')
    expect(contrastRatio(token(LIGHT, '--text-muted'), white)).toBeLessThan(
      contrastRatio(token(LIGHT, '--text-secondary'), white)
    )
  })
})
