/** Types for offline-csp.mjs (ESCSUITE-467); see that file for the full explanation. */

/** Extra sources per directive, for example `{ 'worker-src': ['blob:'] }`. */
export type CspExtra = Record<string, readonly string[]>

export interface FoundScript {
  index: number
  attrs: string
  text: string
  hasSrc: boolean
  executable: boolean
}

export interface CspDirective {
  name: string
  sources: string[]
}

export interface CspMeta {
  index: number
  tag: string
  policy: string
}

export const NETWORK_SCHEMES: readonly string[]
/** What each app adds to the shared directives, beyond its own script hashes. */
export const OFFLINE_CSP_EXTRA: Readonly<{ craft: CspExtra; artist: CspExtra }>
export function scriptHash(text: string): string
export function findScripts(html: string): FoundScript[]
export function parseCsp(policy: string): CspDirective[]
export function networkSources(policy: string): { directive: string; source: string }[]
export function offlineCsp(options: { scriptHashes: readonly string[]; extra?: CspExtra }): string
export function findCspMetas(html: string): CspMeta[]
export function injectOfflineCsp(html: string, options?: { extra?: CspExtra }): string
export function offlineCspPlugin(options: { htmlPath: string; extra?: CspExtra }): {
  name: string
  apply: 'build'
  closeBundle: { order: 'post'; sequential: true; handler(): void }
}
