import { analytics } from './analytics'

export type ToolId = 'craft' | 'artist'

export const GITHUB_URL = 'https://github.com/Bonham-Technologies/ESCAPESUITE'
// The "all downloads" escape hatch: GitHub's own listing of every release,
// which can land on a per-package release (`@escapesuite/shared@…`,
// `@escapesuite/plan@…`, the headless-artist kit) with no offline build
// attached at all — see CRAFT_OFFLINE_BUILD_URL / ARTIST_OFFLINE_BUILD_URL
// below for the links that actually guarantee one (ESCSUITE-195).
export const RELEASES_URL = `${GITHUB_URL}/releases/latest`

/**
 * Stable per-app download URLs. `standalone-release.yml` always (re-)marks
 * the umbrella `vX.Y.Z` release as GitHub's "latest" — and only that release,
 * never a per-package one — and uploads `ESCAPECRAFT-latest.html` /
 * `ESCAPEARTIST-latest.html` to it alongside the versioned names, so these
 * two URLs resolve to that release's own build no matter what else
 * `release.yml` published around it.
 */
export const CRAFT_OFFLINE_BUILD_URL = `${GITHUB_URL}/releases/latest/download/ESCAPECRAFT-latest.html`
export const ARTIST_OFFLINE_BUILD_URL = `${GITHUB_URL}/releases/latest/download/ESCAPEARTIST-latest.html`

const PROD_URLS: Record<ToolId, string> = { craft: '/craft/', artist: '/artist/' }
const DEV_URLS: Record<ToolId, string> = {
  craft: 'http://localhost:5174',
  artist: 'http://localhost:5175',
}

export function toolUrl(tool: ToolId): string {
  return import.meta.env.DEV ? DEV_URLS[tool] : PROD_URLS[tool]
}

export function launchTool(tool: ToolId): void {
  analytics.toolLaunched(tool)
  if (import.meta.env.DEV) {
    window.open(toolUrl(tool), '_blank')
  } else {
    window.location.assign(toolUrl(tool))
  }
}

/**
 * Reports a click on one of the download anchors before the browser follows
 * it: the hero's "all downloads" link (no `tool` — it names no single app)
 * and the open-source section's per-app "Download ESCAPECRAFT" /
 * "Download ESCAPEARTIST" links. Every one of these anchors navigates in a
 * new tab (`target="_blank"`), so — unlike `launchTool`'s same-tab
 * `location.assign` — there is no race between this call and the navigation
 * it precedes.
 */
export function trackOfflineDownload(tool?: ToolId): void {
  analytics.offlineBuildDownloaded(tool)
}
