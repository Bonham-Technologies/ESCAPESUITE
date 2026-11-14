import { GITHUB_URL } from '../../lib/launch'

/**
 * The hub's "Known limitations" list (ESCSUITE-402). Each entry names where
 * the claim comes from: a document or source file in the repository, a ticket,
 * or an owner ruling. Change an entry only when its source changes, and keep
 * the source beside it.
 */

/** A file in the repository on `main`, as a GitHub URL. Append a repo-relative path. */
export const REPO_FILE_URL = `${GITHUB_URL}/blob/main/`

/** The e2e spec that fails if the hosted build's record, edit and export path leaves the origin. */
export const NETWORK_SILENCE_SPEC_URL = `${REPO_FILE_URL}apps/e2e/tests/production/network-silence.spec.ts`

export interface LimitationSource {
  /** What the reader sees: a file path, a ticket key or a ruling. */
  label: string
  /**
   * A GitHub URL for a repository file, or a site path starting with `/` for a
   * page on this site. Omitted for a ticket or ruling that has no public page.
   */
  href?: string
}

export interface Limitation {
  /** Stable anchor id for the section. */
  id: string
  title: string
  /** Plain-language paragraphs. */
  body: string[]
  sources: LimitationSource[]
}

const repoFile = (path: string): LimitationSource => ({ label: path, href: REPO_FILE_URL + path })
const ticket = (key: string): LimitationSource => ({ label: key })

export const LIMITATIONS: Limitation[] = [
  {
    id: 'firefox-mp4-sound',
    title: 'Firefox: MP4 files have no sound',
    body: [
      'Firefox has no AAC audio encoder, so an MP4 made in Firefox is silent. That covers both an ESCAPEARTIST MP4 export and an ESCAPECRAFT MP4 download. Both apps say so before you start.',
      'WebM keeps the sound in Firefox, so choose WebM there, or make the MP4 in Chrome, Edge or Safari.',
    ],
    sources: [
      repoFile('apps/artist/docs/reference/export-dialog-browser-support.md'),
      repoFile('apps/craft/docs/reference/download-formats.md'),
      repoFile('docs/reference/key-constraints.md'),
      ticket('ESCSUITE-295 (parked)'),
    ],
  },
  {
    id: 'system-audio',
    title: 'System audio: Chrome and Edge only',
    body: [
      'ESCAPECRAFT can record the sound your computer is playing (system audio) only in Chrome and Edge. In Firefox and Safari you can still record your screen, camera and microphone; the System Audio toggle is turned off there and says why.',
    ],
    sources: [repoFile('docs/reference/key-constraints.md'), repoFile('apps/craft/src/core/permissions.ts')],
  },
  {
    id: 'safari-export-decoding',
    title: 'Safari: exports decode in the page',
    body: [
      'In Chrome, Edge and Firefox, an MP4 export of MP4 sources decodes video in a background worker, so it keeps going at full speed when you switch to another tab.',
      'Safari decodes in the page instead. So does every browser for WebM sources (every ESCAPECRAFT recording is one) and for WebM exports. A browser slows a page down while its tab is hidden, so keep the ESCAPEARTIST tab in front until the export finishes. When an export decodes in the page, its progress line says so.',
    ],
    sources: [repoFile('apps/artist/docs/reference/video-decode-worker.md'), ticket('ESCSUITE-285')],
  },
  {
    id: 'three-hour-exports',
    title: 'Exports over 3 hours are refused',
    body: [
      'One MP4 or WebM export can be at most 3 hours long. The export mixes all of its audio in one block of memory, and the browser refuses a larger block. For a longer timeline, set in and out points and export it in sections; ESCAPEARTIST tells you this instead of starting.',
    ],
    sources: [repoFile('apps/artist/src/core/exportTypes.ts'), ticket('ESCSUITE-367')],
  },
  {
    id: 'storage-quota',
    title: 'Storage space is set by your browser',
    body: [
      'Recordings and projects are kept on your device, in your browser’s own storage (IndexedDB). The browser decides how much space the site gets. When it runs short, ESCAPECRAFT will not start a new recording and ESCAPEARTIST stops importing or saving, and each tells you to delete something first.',
      'Clearing your browser’s data for the site deletes your recordings and projects too, so download or export anything you want to keep.',
    ],
    sources: [
      repoFile('docs/reference/shared-infrastructure.md'),
      repoFile('apps/craft/src/core/storage.ts'),
      repoFile('apps/artist/src/core/storageErrors.ts'),
    ],
  },
  {
    id: 'safari-private-browsing',
    title: 'Safari Private Browsing keeps nothing',
    body: [
      'Recording, importing and saving work in a Safari private window. But a private window’s storage is temporary: when you close the window, Safari deletes the recordings and projects in it. Download or export what you want to keep before you close it.',
    ],
    sources: [repoFile('docs/reference/shared-infrastructure.md'), ticket('ESCSUITE-397')],
  },
  {
    id: 'transcribe-captions',
    title: 'Transcribe to captions: only where the browser has on-device speech recognition, and in real time',
    body: [
      'ESCAPEARTIST’s Transcribe to captions uses your browser’s own on-device speech recognition, so the button appears only where the browser has it. Today that means Chrome on a computer, and Edge, Opera and Brave, which are built on the same engine, where they have it too. Safari and phones do not have it. Firefox is adding it; the button appears there once your version has it. Other Chromium-based apps that do not identify as Chrome, Edge, Opera or Brave never show it, because asking them can crash the page.',
      'It listens in real time: a 10-minute timeline takes about 10 minutes, and you can stop it at any point. The language must be one your browser can recognise on this device. If it cannot, ESCAPEARTIST tells you and does not transcribe.',
      'The first time, your browser may download a speech language pack, which is its on-device recognition model for one language. ESCAPEARTIST asks first, with the notice “Your browser will download a speech language pack once. Your audio never leaves this device.” The browser downloads the pack itself, from wherever its maker provides it (Chrome gets it from Google). ESCAPEARTIST does not choose, see or pass on that download. Transcribing makes no network request of its own: ESCAPEARTIST downloads nothing for it and sends no audio or captions anywhere. Without a network, transcription works only if the pack is already installed.',
    ],
    sources: [
      repoFile('apps/artist/docs/reference/on-device-transcription.md'),
      repoFile('apps/artist/src/core/speechRecognitionLocal.ts'),
      ticket('ESCSUITE-404'),
    ],
  },
  {
    id: 'float-controls',
    title: 'Float controls: not in every browser, and not when embedded',
    body: [
      'ESCAPECRAFT’s Float controls keep the timer, level meters and record buttons in a small window on top of whatever you are recording. They need the browser’s Document Picture-in-Picture window. Chrome and Edge have it; Safari does not. In any other browser the Float controls button appears only if that browser has it.',
      'It is also not shown when ESCAPECRAFT is embedded in another page (in an iframe). Open ESCAPECRAFT on its own page to use it.',
    ],
    sources: [repoFile('apps/craft/src/hooks/useFloatingControlsWindow.ts'), ticket('ESCSUITE-400')],
  },
  {
    id: 'no-mobile',
    title: 'Phones and tablets are not supported',
    body: [
      'ESCAPE Suite is made for desktop browsers. Its pages may open on a phone or tablet, but recording, editing and exporting there are not supported.',
    ],
    sources: [{ label: 'Owner ruling, 2026-10-01' }],
  },
  {
    id: 'hosted-analytics',
    title: 'What the hosted site sends',
    body: [
      'The hosted site (www.escapesuite.io) uses Vercel Web Analytics. Our code sends two kinds of record: a page view when a page opens, and a named event when you do certain things, such as “Recording Started”, “Export Completed” or “Tool Launched”.',
      'Every record includes the path of the page you are on, such as /artist/, and never the part of the address after a ? or #. If you came from another site, or another site shows the app inside its own page, the record also includes that site’s address. Browsers normally shorten it to just the site’s name, such as https://example.com/, unless that site asks for more. Vercel also works out your browser, operating system, device type and approximate location (down to the city) from the request itself.',
      'An event adds at most a few short labels and numbers: which tool, which export format, a length in whole seconds, a media type (video, image or audio), and for a failed export its error type and how far it got. Nothing you record, import, type or export is sent, and neither are file names.',
      'A website that embeds ESCAPECRAFT or ESCAPEARTIST in its own page can put its own address, a video’s address, a title, a whole project or a window name into the app’s address after a ?. None of that is sent, and neither is the random ID ESCAPECRAFT adds when it hands a recording to ESCAPEARTIST.',
      'Both kinds of record go to /_vercel/insights/ on www.escapesuite.io itself, not to another site. Our code sets no cookies.',
      'The offline build contains no analytics code at all. It makes no network requests unless you give ESCAPEARTIST a video address to load, and then it fetches only that address.',
    ],
    sources: [
      repoFile('docs/reference/vercel-analytics.md'),
      repoFile('packages/shared/src/analytics/index.ts'),
      repoFile('packages/shared/src/analytics/beforeSend.ts'),
      repoFile('docs/reference/integration-api.md'),
      { label: 'Privacy Policy', href: '/privacy' },
    ],
  },
]
