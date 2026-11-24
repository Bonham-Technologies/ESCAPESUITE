// `index.html` carries a JSON-LD block describing the app to search engines (ESCSUITE-456).
//
// This reads the source `index.html` rather than a build output: Vite keeps an
// inline `application/ld+json` block as written, so the source is what ships, and
// no build has to exist for the unit suite. Vitest's cwd is the package root.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8')
const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]

describe('ESCAPEARTIST structured data', () => {
  it('has exactly one JSON-LD block', () => {
    expect(blocks).toHaveLength(1)
  })

  it('describes a free WebApplication at its canonical URL', () => {
    const data = JSON.parse(blocks[0]?.[1] ?? 'null')
    expect(data['@context']).toBe('https://schema.org')
    expect(data['@type']).toBe('WebApplication')
    expect(data.name).toBe('ESCAPEARTIST')
    expect(data.url).toBe('https://escapesuite.tech/artist/')
    expect(html).toContain(`<link rel="canonical" href="${data.url}" />`)
    expect(data.applicationCategory).toBe('MultimediaApplication')
    expect(data.operatingSystem).toBe('Any (web browser)')
    expect(data.isAccessibleForFree).toBe(true)
    expect(data.offers).toEqual({ '@type': 'Offer', price: '0', priceCurrency: 'USD' })
    expect(data.description.length).toBeGreaterThanOrEqual(50)
    expect(data.description.length).toBeLessThanOrEqual(160)
    expect(data.publisher).toEqual({
      '@type': 'Organization',
      name: 'Bonham Technologies, LLC',
      url: 'https://bonham.tech/',
    })
  })
})
