import { renderProject } from './renderProject'
import type { RenderInput } from './types'

declare global {
  interface Window {
    __renderProject: (input: RenderInput, onProgress?: (p: number) => void) => ReturnType<typeof renderProject>
    __headlessReady: boolean
  }
}

window.__renderProject = renderProject
window.__headlessReady = true
