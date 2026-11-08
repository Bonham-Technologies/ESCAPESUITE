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
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

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

    // ESCSUITE-422: the selected clip's ring sits on the timeline's own
    // surfaces, which are not among the four above.
    it(`keeps --accent-ring at 3:1 on the timeline (${palette})`, () => {
      const ring = token(palette, '--accent-ring')
      for (const surface of ['--timeline-bg', '--timeline-track-bg']) {
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

  // ESCSUITE-421 moved the preview placeholder off --text-muted: it sits on
  // .videoWrapper's hard-coded #111 in both themes. ESCSUITE-422 pins the pair.
  it('keeps the preview placeholder at 4.5:1 on its own dark box, in both themes', () => {
    const preview = moduleCss('src/components/Preview/PreviewPlayer.module.css')
    const ink = declaration(preview, '.placeholder', 'color')
    const box = declaration(preview, '.videoWrapper', 'background')
    expect(ink).toMatch(/^#[0-9a-f]{6}$/i)
    expect(box).toMatch(/^#[0-9a-f]{3}([0-9a-f]{3})?$/i)
    expect(contrastRatio(ink, expandHex(box))).toBeGreaterThanOrEqual(4.5)
  })
})

/**
 * ESCSUITE-422: every accent fill in ARTIST's stylesheets, read rule by rule.
 * White on --accent-primary (#4a9eff) is 2.75:1, under both 4.5:1 for text and
 * 3:1 for an icon, and a label that sat on the fill white had been missed rule
 * by rule (#275, ESCSUITE-421, the play button and the pressed inspector
 * buttons here). The ink on an accent fill is --accent-on-fill, in both
 * themes, and so is the ink on the one hover fill the stylesheets use.
 */
describe('accent fills across the stylesheets', () => {
  const ACCENT_FILL = /background(?:-color)?\s*:\s*(?:var\(--accent-primary\)|#4a9eff|#3a8eef|rgba\(\s*74\s*,\s*158\s*,\s*255)/i
  const WHITE_INK = /(?:^|[;{\s])color\s*:\s*(?:white|#fff(?:fff)?)\s*(?:!important)?\s*(?:;|$)/i

  const rules = cssFiles(join(process.cwd(), 'src')).flatMap((file) =>
    [...moduleCss(file).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({
      where: `${relative(process.cwd(), file)} ${selector.trim()}`,
      body,
    }))
  )

  it('reads the stylesheets it means to', () => {
    expect(rules.filter((r) => ACCENT_FILL.test(r.body)).length).toBeGreaterThan(20)
  })

  it('draws no white label on an accent fill', () => {
    const whiteOnAccent = rules
      .filter((r) => ACCENT_FILL.test(r.body) && WHITE_INK.test(r.body))
      .map((r) => r.where)
    expect(whiteOnAccent).toEqual([])
  })

  it('uses one hover fill, which keeps --accent-on-fill at 4.5:1', () => {
    // var(--accent-hover, #3a7bc8) named a token that does not exist, and its
    // fallback put the ink at 4.32:1.
    expect(rules.filter((r) => /--accent-hover/.test(r.body)).map((r) => r.where)).toEqual([])
    for (const palette of [DARK, LIGHT]) {
      expect(contrastRatio(token(palette, '--accent-on-fill'), '#3a8eef')).toBeGreaterThanOrEqual(4.5)
    }
  })
})

/** A stylesheet's text with its comments removed. */
function moduleCss(file: string): string {
  return readFileSync(file.startsWith('/') ? file : join(process.cwd(), file), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    ''
  )
}

/** Every `.css` file under `dir`. */
function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return cssFiles(path)
    return entry.name.endsWith('.css') ? [path] : []
  })
}

/** One declaration's value in the block whose selector is exactly `selector`. */
function declaration(cssText: string, selector: string, property: string): string {
  const block = [...cssText.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(([, sel]) => sel.trim() === selector)
  expect(block, `no \`${selector}\` block`).toBeTruthy()
  const match = (block as RegExpMatchArray)[2].match(new RegExp(`(?:^|[;\\s])${property}\\s*:\\s*([^;]+);`))
  expect(match, `no \`${property}\` in \`${selector}\``).toBeTruthy()
  return (match as RegExpMatchArray)[1].trim()
}

/** `#abc` to `#aabbcc`; a six-digit colour is returned as it is. */
function expandHex(hex: string): string {
  return hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join('')}` : hex
}
