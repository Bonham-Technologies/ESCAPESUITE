import { renderProject, renderProjectToFile } from './renderProject'
import type { RenderFileInput, RenderInput } from './types'

declare global {
  interface Window {
    __renderProject: (input: RenderInput, onProgress?: (p: number) => void) => ReturnType<typeof renderProject>
    __renderProjectToFile: (input: RenderFileInput, onProgress?: (p: number) => void) => ReturnType<typeof renderProjectToFile>
    __headlessReady: boolean
  }
}

window.__renderProject = renderProject
window.__renderProjectToFile = renderProjectToFile
window.__headlessReady = true
