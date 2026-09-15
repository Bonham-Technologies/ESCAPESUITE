// The two palettes in `src/index.css` have to stay in step.
//
// `:root` is the dark palette and `:root[data-theme="light"]` overrides it —
// so a colour token added to `:root` alone is silently inherited by the light
// theme, where it was never designed to be read. That is exactly how
// `--error-text` shipped a red tuned for a navy background onto a near-white
// one, at 2.58:1, and no axe run that only ever opens the dark default can see
// it.
//
// This reads the stylesheet rather than the DOM: the tokens are plain CSS, so
// there is no module to import and nothing to mock, and jsdom does not apply
// stylesheets anyway. It is read off disk rather than imported, because Vite
// hands a `.css` import to its CSS pipeline (and `?raw` to the jsdom
// transformer) rather than back as text. Vitest's cwd is the package root.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const css = readFileSync(join(process.cwd(), 'src/index.css'), 'utf8')

/** The declarations inside one selector's block, as `--name: value` pairs. */
function tokensIn(selector: string): Map<string, string> {
  const start = css.indexOf(`${selector} {`)
  expect(start, `no \`${selector}\` block in index.css`).toBeGreaterThan(-1)
  const end = css.indexOf('\n}', start)
  const block = css.slice(start, end)

  const tokens = new Map<string, string>()
  for (const [, name, value] of block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    tokens.set(name, value.trim())
  }
  return tokens
}

/** Spacing, radii and z-indexes are palette-independent; colours are not. */
function colourTokens(tokens: Map<string, string>): string[] {
  return [...tokens]
    .filter(([, value]) => /#[0-9a-f]{3,8}\b/i.test(value))
    .map(([name]) => name)
    .sort()
}

describe('ESCAPECRAFT theme tokens', () => {
  it('gives the light theme its own value for every colour the dark one defines', () => {
    const dark = colourTokens(tokensIn(':root'))
    const light = new Set(colourTokens(tokensIn(':root[data-theme="light"]')))

    expect(dark.length).toBeGreaterThan(10)
    expect(dark.filter((name) => !light.has(name))).toEqual([])
  })

  it('draws red text in a colour that is not the red it fills shapes with', () => {
    // --error is a fill colour (the recording dot, the record button) and is
    // allowed to sit below the 4.5:1 text minimum; --error-text is the one the
    // recording label, the timer and the notice line use. They are different
    // values in both palettes precisely because that is the whole point of the
    // second token — see the comments beside them in index.css.
    for (const selector of [':root', ':root[data-theme="light"]']) {
      const tokens = tokensIn(selector)
      expect(tokens.get('--error'), `${selector} --error`).toBeTruthy()
      expect(tokens.get('--error-text'), `${selector} --error-text`).toBeTruthy()
      expect(tokens.get('--error-text')).not.toBe(tokens.get('--error'))
    }
  })
})
