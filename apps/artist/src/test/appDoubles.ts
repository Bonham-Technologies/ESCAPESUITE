// Recording doubles for App's collaborators.
//
// App talks to four modules that reach outside the editor: IndexedDB storage,
// the project file reader/writer, the host integration channel, and the media
// probe. Each test file replaces them with these doubles through
//
//   vi.mock('./core/storage', async () => (await import('./test/appDoubles')).storageDouble())
//
// — an async factory, so it is safe against vi.mock's hoisting. Every function
// records its calls, and the defaults are the quiet case (no saved session, no
// stored video, the user cancelling the file picker), which each test overrides
// with vi.mocked(...).mockResolvedValue for the case it is about.
//
// Lives under src/test/ so neither the vitest `include` glob nor the coverage
// `include` glob picks it up.
import { vi } from 'vitest'
import type { SourceVideo } from '../store/types'

export const sampleVideo: SourceVideo = {
  id: 'video1',
  name: 'test.mp4',
  duration: 10,
  width: 1920,
  height: 1080,
  frameRate: 30,
  mimeType: 'video/mp4',
  size: 1000000,
}

export function storageDouble() {
  return {
    getVideoBlob: vi.fn(() => Promise.resolve(new Blob(['test'], { type: 'video/mp4' }))),
    getStorageEstimate: vi.fn(() =>
      Promise.resolve({ used: 0, quota: 100000000, available: 100000000 })
    ),
    clearAllVideos: vi.fn(() => Promise.resolve()),
    deleteVideo: vi.fn(() => Promise.resolve()),
    saveSessionState: vi.fn(() => Promise.resolve()),
    getSessionState: vi.fn(() => Promise.resolve(undefined)),
    clearSessionState: vi.fn(() => Promise.resolve()),
    getVideo: vi.fn(() => Promise.resolve(undefined)),
    getThumbnail: vi.fn(() => Promise.resolve(undefined)),
    getSetting: vi.fn(() => Promise.resolve(null)),
    setSetting: vi.fn(() => Promise.resolve()),
  }
}

export function projectManagerDouble() {
  return {
    saveProject: vi.fn(() => Promise.resolve()),
    loadProject: vi.fn(() => Promise.resolve({ project: {}, sourceVideos: [] })),
    showOpenProjectDialog: vi.fn(() => Promise.resolve(null)),
  }
}

/** The shape parseUrlParams returns when nothing was passed in the URL. */
export const defaultUrlParams = () => ({
  videos: [] as string[],
  projectData: null,
  autoPlay: false,
  loadVideoId: null as string | null,
  suppressRestore: false,
  title: null as string | null,
  hostOrigin: null as string | null,
})

export function integrationDouble() {
  return {
    initIntegration: vi.fn(() => () => {}),
    parseUrlParams: vi.fn(() => defaultUrlParams()),
    loadVideoFromUrl: vi.fn(() => Promise.resolve({ blob: new Blob(), name: 'test.mp4' })),
    sendMessage: vi.fn(),
  }
}

export function videoProcessorDouble() {
  return {
    processVideoFile: vi.fn(() => Promise.resolve({ ...sampleVideo })),
    processImageFile: vi.fn(() =>
      Promise.resolve({
        id: 'image1',
        name: 'test.png',
        duration: 5,
        width: 800,
        height: 600,
        frameRate: 1,
        mimeType: 'image/png',
        size: 500000,
        mediaType: 'image',
      })
    ),
    processAudioFile: vi.fn(() =>
      Promise.resolve({
        id: 'audio1',
        name: 'test.mp3',
        duration: 120,
        width: 0,
        height: 0,
        frameRate: 0,
        mimeType: 'audio/mp3',
        size: 3000000,
        mediaType: 'audio',
      })
    ),
  }
}
