/**
 * Which engines may decode MP4 sources in the WebCodecs worker (ESCSUITE-254).
 *
 * The `<video>` path is the oracle: it is what every MP4 export used before
 * the worker decoded anything. An engine is admitted only once its worker
 * output has been measured against its own `<video>`:
 *
 * - **Chromium** (153): the parity spec's export frames 0.045 and 0.268/255
 *   apart, the probe decode 0.00; all four display rotations match.
 * - **Firefox** (155): export frames 0.336 and 0.920/255 apart, eight colour
 *   and size variants exact. Its VideoDecoder drops `rotation`, so a rotated
 *   source is refused and keeps `<video>` (with the in-page notice).
 *
 * Everything else is refused — WebKit 26.6 measured 4.46-17.45/255 apart
 * (colour, not timing) — and so is the next engine nobody has measured, by
 * default rather than by accident. Admitting one is ESCSUITE-262.
 *
 * Engine detection, not feature detection: nothing an engine's
 * `isConfigSupported` answers says whether its decoder's output matches its
 * own `<video>`. Chromium is read from `navigator.userAgentData` (a real API
 * Firefox and WebKit do not ship) rather than from the user-agent string,
 * which every Chromium fork and WebKit browser imitates; Firefox from its
 * `Gecko/` and `Firefox/` tokens.
 */

/** The parts of `navigator` this reads; `userAgentData` is not in TypeScript's DOM lib. */
export interface EngineNavigator {
  userAgent?: string;
  userAgentData?: { brands?: ReadonlyArray<{ brand: string }> };
}

export function isMeasuredWorkerDecodeEngine(nav: EngineNavigator | undefined): boolean {
  if (!nav) return false;
  if (nav.userAgentData?.brands?.some(({ brand }) => brand === 'Chromium')) return true;
  const userAgent = nav.userAgent ?? '';
  return /Gecko\//.test(userAgent) && /Firefox\//.test(userAgent);
}
