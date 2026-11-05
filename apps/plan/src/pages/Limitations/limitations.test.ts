import { describe, it, expect } from 'vitest'
import { LIMITATIONS, NETWORK_SILENCE_SPEC_URL, REPO_FILE_URL } from './limitations'

describe('LIMITATIONS', () => {
  it('names at least one source for every limitation', () => {
    expect(LIMITATIONS.length).toBeGreaterThan(0)
    for (const limitation of LIMITATIONS) {
      expect(limitation.sources.length, limitation.id).toBeGreaterThan(0)
      for (const source of limitation.sources) {
        expect(source.label.trim(), limitation.id).not.toBe('')
      }
    }
  })

  it('has unique ids, so each section can be linked to', () => {
    const ids = LIMITATIONS.map((limitation) => limitation.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  // ESCSUITE-402's list: each limitation the page must state, found by its
  // source rather than its wording, so a copy edit does not break the test.
  it.each([
    ['firefox-mp4-sound', 'apps/artist/docs/reference/export-dialog-browser-support.md'],
    ['system-audio', 'docs/reference/key-constraints.md'],
    ['safari-export-decoding', 'apps/artist/docs/reference/video-decode-worker.md'],
    ['three-hour-exports', 'apps/artist/src/core/exportTypes.ts'],
    ['storage-quota', 'docs/reference/shared-infrastructure.md'],
    ['safari-private-browsing', 'docs/reference/shared-infrastructure.md'],
    ['hosted-analytics', 'docs/reference/vercel-analytics.md'],
  ])('lists %s with its source document %s', (id, path) => {
    const limitation = LIMITATIONS.find((l) => l.id === id)
    expect(limitation).toBeDefined()
    expect(limitation!.sources.map((s) => s.href)).toContain(REPO_FILE_URL + path)
  })

  it.each([
    ['firefox-mp4-sound', 'ESCSUITE-295'],
    ['safari-export-decoding', 'ESCSUITE-285'],
    ['three-hour-exports', 'ESCSUITE-367'],
    ['safari-private-browsing', 'ESCSUITE-397'],
  ])('lists %s with its ticket %s', (id, ticket) => {
    const limitation = LIMITATIONS.find((l) => l.id === id)
    expect(limitation!.sources.some((s) => s.label.startsWith(ticket))).toBe(true)
  })

  it('cites the owner ruling for no mobile support', () => {
    const mobile = LIMITATIONS.find((l) => l.id === 'no-mobile')
    expect(mobile!.sources.map((s) => s.label)).toContain('Owner ruling, 2026-10-01')
  })

  it('says the offline build sends nothing', () => {
    const analytics = LIMITATIONS.find((l) => l.id === 'hosted-analytics')
    expect(analytics!.body.join(' ')).toMatch(/offline build contains no analytics code/i)
    // The one fetch in app code: ESCAPEARTIST's ?video= / LOAD_VIDEO loader.
    expect(analytics!.body.join(' ')).toMatch(/unless you give ESCAPEARTIST a video address/i)
  })

  it('names both apps and the host page in the embedding exception', () => {
    const body = LIMITATIONS.find((l) => l.id === 'hosted-analytics')!.body.join(' ')
    expect(body).toMatch(/embeds ESCAPECRAFT or ESCAPEARTIST/)
    expect(body).toMatch(/shows the app inside its own page/)
  })

  it('says the query is never sent, since ESCSUITE-406 strips it', () => {
    const body = LIMITATIONS.find((l) => l.id === 'hosted-analytics')!.body.join(' ')
    expect(body).toMatch(/never the part of the address after a \? or #/)
    expect(body).toMatch(/None of that is sent/)
    expect(body).not.toMatch(/that is sent as part of the address/)
  })

  it('links every document source to the repository on GitHub', () => {
    for (const source of LIMITATIONS.flatMap((l) => l.sources)) {
      if (source.href !== undefined) {
        expect(source.href.startsWith(REPO_FILE_URL) || source.href.startsWith('/')).toBe(true)
      }
    }
  })
})

describe('NETWORK_SILENCE_SPEC_URL', () => {
  it('points at the production network-silence spec on main', () => {
    expect(NETWORK_SILENCE_SPEC_URL).toBe(
      'https://github.com/Bonham-Technologies/ESCAPESUITE/blob/main/apps/e2e/tests/production/network-silence.spec.ts'
    )
  })
})
