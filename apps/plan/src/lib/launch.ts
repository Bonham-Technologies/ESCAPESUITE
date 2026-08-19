import { analytics } from './analytics'

export type ToolId = 'craft' | 'artist'

export const GITHUB_URL = 'https://github.com/Bonham-Technologies/ESCAPESUITE'
export const RELEASES_URL = `${GITHUB_URL}/releases/latest`

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
