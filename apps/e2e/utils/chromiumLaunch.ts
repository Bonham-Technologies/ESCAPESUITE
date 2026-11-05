/**
 * Launch flags every Chromium project in every Playwright config here passes.
 *
 * ESCSUITE-404: Playwright's Chromium headless shell kills a page's renderer
 * ("Target crashed") when the page calls `SpeechRecognition.available()`: the
 * shell has the on-device Web Speech API in Blink but not the browser-side
 * speech service behind it. ESCAPEARTIST asks `available()` when the editor
 * opens, to decide whether to show "Transcribe to captions", so without this
 * flag every ARTIST page would crash in the headless shell. Turning the Blink
 * feature off removes `available()`, `install()` and `processLocally`, so the
 * editor sees no on-device recognition and shows no control.
 * `tests/regressions/ESCSUITE-404.spec.ts` replaces the whole API with a stub,
 * so it still drives the feature.
 */
export const CHROMIUM_TEST_ARGS = ['--disable-blink-features=OnDeviceWebSpeechAvailable']
