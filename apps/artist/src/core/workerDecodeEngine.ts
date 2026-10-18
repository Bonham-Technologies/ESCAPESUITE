/**
 * Which engines may decode MP4 sources in the WebCodecs worker (ESCSUITE-254).
 *
 * The `<video>` path is the oracle: it is what every MP4 export used before
 * the worker decoded anything. An engine is admitted only once its worker
 * output has been measured against its own `<video>`:
 *
 * - **Chromium** (153): the parity spec's export frames 0.000/255 apart at
 *   every compared frame since ESCSUITE-265, the probe decode 0.00; all four
 *   display rotations match.
 * - **Firefox** (155): export frames 0.000-0.379/255 apart (ESCSUITE-262),
 *   eight colour and size variants exact. Its VideoDecoder drops `rotation`,
 *   so a rotated source is refused and keeps `<video>` (with the in-page
 *   notice).
 *
 * The parity spec (`apps/e2e/tests/export/decode-worker.spec.ts`) gates CI on
 * Chromium only; Firefox runs under `pnpm test:e2e:browsers` (or
 * `--project=firefox`).
 *
 * **WebKit (26.6) is not admitted** (ESCSUITE-285). ESCSUITE-262 measured why:
 * its VideoDecoder ignores `VideoDecoderConfig.colorSpace` and hands back
 * frames `drawImage` paints as plain BT.709, while its `<video>` picks the
 * matrix per stream and colour-manages — 6.5-8.0/255 mean, up to 17.6 on one
 * frame, off its own `<video>` across six colour fixtures (colour, not
 * timing). Re-tagging every decoded frame with `<video>`'s matrix and
 * primaries brings all six to 0.44-1.22, but that is one extra `VideoFrame`
 * allocated and closed per decoded frame in the worker, for an engine that is
 * not a primary export target and whose parity spec cannot run end to end
 * under Playwright (IndexedDB refuses the imported Blob, ESCSUITE-258). The
 * in-page `<video>` path is correct on WebKit and stays.
 *
 * Every other engine is refused too — the next one nobody has measured, by
 * default rather than by accident.
 *
 * Engine detection, not feature detection: nothing an engine's
 * `isConfigSupported` answers says whether its decoder's output matches its
 * own `<video>`. Chromium is read from `navigator.userAgentData` (a real API
 * Firefox and WebKit do not ship) rather than from the user-agent string,
 * which every Chromium fork and WebKit browser imitates; Firefox from its
 * `Gecko/` and `Firefox/` tokens.
 *
 * A second, narrower list lives below: `isMeasuredFrameRateEngine`, the
 * frame-rate probe's (Chromium only, ESCSUITE-327).
 */

/** The parts of `navigator` this reads; `userAgentData` is not in TypeScript's DOM lib. */
export interface EngineNavigator {
  userAgent: string;
  userAgentData?: { brands?: ReadonlyArray<{ brand: string }> };
}

export function isMeasuredWorkerDecodeEngine(nav: EngineNavigator | undefined): boolean {
  if (!nav) return false;
  if (isMeasuredFrameRateEngine(nav)) return true;
  return isFirefoxEngine(nav);
}

/**
 * Which engines the import-time frame-rate probe (`frameRateProbe.ts`,
 * ESCSUITE-276) may measure on (ESCSUITE-327): **Chromium only**, narrower than
 * the worker's list above on purpose. The worker's Firefox parity was measured
 * against Firefox's own `<video>`; the probe's was not — Firefox's
 * `requestVideoFrameCallback` metadata (`presentedFrames`, `mediaTime` stamps)
 * was never characterised per rate and container, and the 2026-10-17 run of the
 * nine `testsrc` fixtures on Firefox 157 stored two wrong `'measured'` claims
 * (120 fps MP4 as 124.62, 30 fps WebM as 34.33). On an engine this refuses the
 * probe answers `undefined` and the source is stored 30 `'assumed'`. Admitting
 * Firefox is a measurement task, not a code change here.
 */
export function isMeasuredFrameRateEngine(nav: EngineNavigator | undefined): boolean {
  if (!nav) return false;
  return nav.userAgentData?.brands?.some(({ brand }) => brand === 'Chromium') === true;
}

/**
 * Firefox, by its `Gecko/` and `Firefox/` tokens — the one Firefox test. The
 * WebM exporter reads it too, to gate its colour relabel (ESCSUITE-284,
 * `exportWebM.ts` and `vpxColorLabel.ts`).
 */
export function isFirefoxEngine(nav: EngineNavigator | undefined): boolean {
  if (!nav) return false;
  return /Gecko\//.test(nav.userAgent) && /Firefox\//.test(nav.userAgent);
}
