/**
 * Which engine this is, read the one way the suite trusts (ESCSUITE-254):
 * Chromium from `navigator.userAgentData` (a real API Firefox and WebKit do
 * not ship) rather than from the user-agent string, which every Chromium fork
 * and WebKit browser imitates.
 *
 * Its own module, apart from `workerDecodeEngine.ts`, which builds its engine
 * lists on it: the export suites replace that module wholesale to pick an
 * engine for the decode worker, and the seek-wedge refusal (`seekWedge.ts`,
 * ESCSUITE-412) reads the engine for its copy whatever those suites pick.
 */

/** The parts of `navigator` this reads; `userAgentData` is not in TypeScript's DOM lib. */
export interface EngineNavigator {
  userAgent: string;
  userAgentData?: { brands?: ReadonlyArray<{ brand: string }> };
}

/** Chromium, by `navigator.userAgentData`'s `Chromium` brand: the one Chromium test. */
export function isChromiumEngine(nav: EngineNavigator | undefined): boolean {
  if (!nav) return false;
  return nav.userAgentData?.brands?.some(({ brand }) => brand === 'Chromium') === true;
}
