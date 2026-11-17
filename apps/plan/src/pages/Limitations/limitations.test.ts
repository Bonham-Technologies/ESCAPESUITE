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
    // ESCSUITE-445
    ['transcribe-captions', 'apps/artist/docs/reference/on-device-transcription.md'],
    ['float-controls', 'apps/craft/src/hooks/useFloatingControlsWindow.ts'],
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
    ['transcribe-captions', 'ESCSUITE-404'],
    ['float-controls', 'ESCSUITE-400'],
  ])('lists %s with its ticket %s', (id, ticket) => {
    const limitation = LIMITATIONS.find((l) => l.id === id)
    expect(limitation!.sources.some((s) => s.label.startsWith(ticket))).toBe(true)
  })

  // ESCSUITE-445: claim only what ARTIST's own doc and notice claim.
  it('states what the transcription language pack is and that no audio leaves the device', () => {
    const body = LIMITATIONS.find((l) => l.id === 'transcribe-captions')!.body.join(' ')
    expect(body).toMatch(/Chrome on a computer, and Edge, Opera and Brave/)
    expect(body).toMatch(/real time/)
    expect(body).toMatch(/speech language pack/)
    expect(body).toMatch(/download/)
    // ARTIST's notice (languagePackNotice in apps/artist/src/core/transcriptionLanguage.ts) for en-US, word for word; plan cannot import ARTIST.
    expect(body).toContain(
      '“Your browser will download a speech language pack for English (United States) once. Your audio never leaves this device.”'
    )
    expect(body).not.toMatch(/browser language only/i)
  })

  it('scopes the transcription privacy claim to transcribing, and does not date the browser list', () => {
    const entry = LIMITATIONS.find((l) => l.id === 'transcribe-captions')!
    const body = entry.body.join(' ')
    expect(entry.title).toBe(
      'Transcribe to captions: only where the browser has on-device speech recognition, and in real time'
    )
    expect(body).toMatch(/Transcribing makes no network request of its own/)
    expect(body).toMatch(/sends no audio or captions anywhere/)
    expect(body).not.toMatch(/anything else anywhere/)
    expect(body).toMatch(/Firefox is adding it; the button appears there once your version has it/)
    expect(body).not.toMatch(/released versions/)
    expect(body).toMatch(/tells you and does not transcribe/)
    expect(body).not.toMatch(/hides the button/)
  })

  // ESCSUITE-445: canFloatControls() feature-detects the API, so the entry must
  // not promise "Chromium only", nor name browsers the repo has no source for.
  it('says Float controls need Document Picture-in-Picture and a top-level page', () => {
    const entry = LIMITATIONS.find((l) => l.id === 'float-controls')!
    const text = [entry.title, ...entry.body].join(' ')
    expect(text).toMatch(/Document Picture-in-Picture/)
    expect(text).toMatch(/embed/)
    expect(text).not.toMatch(/Chromium (browsers )?only|only Chromium/i)
    expect(text).toMatch(/Chrome and Edge have it; Safari does not/)
    expect(text).toMatch(/In any other browser the Float controls button appears only if that browser has it/)
    expect(text).not.toMatch(/Firefox has it/)
  })

  it('does not say ESCAPEARTIST picks where the language pack comes from', () => {
    const body = LIMITATIONS.find((l) => l.id === 'transcribe-captions')!.body.join(' ')
    expect(body).toMatch(/does not choose, see or pass on that download/)
    expect(body).not.toMatch(/Firefox, Safari and phones do not/)
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
