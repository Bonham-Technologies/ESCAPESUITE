import { Page, expect } from '@playwright/test'

/**
 * Helpers for ESCAPECRAFT's crash-safe takes (ESCSUITE-466): a take is kept in
 * the origin private file system (OPFS) while it records, under
 * `escapecraft-takes/<takeId>/`, and offered back when CRAFT next opens.
 */

/** The OPFS directory CRAFT keeps takes in (`core/takeStore.ts`). */
export const TAKES_DIRECTORY = 'escapecraft-takes'

export interface KeptTake {
  takeId: string
  /** File name to size in bytes, journal included. */
  files: Record<string, number>
}

/** Every take directory CRAFT has left in OPFS, with its files' sizes. */
export async function keptTakes(page: Page): Promise<KeptTake[]> {
  return page.evaluate(async (dirName) => {
    type Entries = { entries(): AsyncIterable<[string, FileSystemHandle]> }
    const root = await navigator.storage.getDirectory()
    let dir: FileSystemDirectoryHandle
    try {
      dir = await root.getDirectoryHandle(dirName)
    } catch {
      return []
    }
    const takes: { takeId: string; files: Record<string, number> }[] = []
    for await (const [takeId, handle] of (dir as unknown as Entries).entries()) {
      if (handle.kind !== 'directory') continue
      const files: Record<string, number> = {}
      for await (const [name, file] of (handle as unknown as Entries).entries()) {
        if (file.kind === 'file') files[name] = (await (file as FileSystemFileHandle).getFile()).size
      }
      takes.push({ takeId, files })
    }
    return takes
  }, TAKES_DIRECTORY)
}

/**
 * Whether this browser hands a dedicated worker an OPFS sync access handle —
 * the one OPFS write CRAFT trusts to survive a crash. Where it does not, CRAFT
 * records in memory as before and says the take is not crash-protected.
 */
export async function syncAccessHandlesAvailable(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    const source = `
      onmessage = async () => {
        try {
          const root = await navigator.storage.getDirectory();
          const file = await root.getFileHandle('sync-handle-probe', { create: true });
          const access = await file.createSyncAccessHandle();
          access.close();
          await root.removeEntry('sync-handle-probe');
          postMessage(true);
        } catch {
          postMessage(false);
        }
      };`
    try {
      const worker = new Worker(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })))
      const answer = await new Promise<boolean>((resolve) => {
        worker.onmessage = (event) => resolve(event.data === true)
        worker.onerror = () => resolve(false)
        worker.postMessage(null)
      })
      worker.terminate()
      return answer
    } catch {
      return false
    }
  })
}

/** Wait until the live take's primary file holds at least `bytes`. */
export async function waitForKeptBytes(page: Page, bytes: number): Promise<KeptTake> {
  let kept: KeptTake | undefined
  await expect
    .poll(
      async () => {
        kept = (await keptTakes(page))[0]
        return kept?.files['primary.webm'] ?? 0
      },
      { timeout: 30_000, message: 'the live take never reached the device' }
    )
    .toBeGreaterThanOrEqual(bytes)
  return kept!
}

export interface StoredTakeHealth {
  /** `<video>.duration` on `loadedmetadata`. */
  duration: number
  /** Whether a seek to the middle fired `seeked`. */
  seeked: boolean
  /** Where it landed. */
  seekedTo: number
  /** Audio channels the stored file decodes to (0 for none). */
  audioChannels: number
  /** Seconds of decoded audio. */
  audioSeconds: number
  size: number
}

/**
 * Load the one recording in `video-editor-db` and check it is alive: a finite
 * duration, a seek to the middle that lands, and audio that decodes. The
 * callers record exactly one take in a fresh context, so "the one recording"
 * is unambiguous.
 */
export async function storedTakeHealth(page: Page): Promise<StoredTakeHealth> {
  return page.evaluate(async () => {
    const blob = await new Promise<Blob>((resolve, reject) => {
      const request = indexedDB.open('video-editor-db')
      request.onerror = () => reject(new Error('Failed to open video-editor-db'))
      request.onsuccess = () => {
        const getAll = request.result.transaction('videos', 'readonly').objectStore('videos').getAll()
        getAll.onerror = () => reject(new Error('Failed to read videos store'))
        getAll.onsuccess = () => {
          const records = getAll.result as Array<{ blob: Blob; metadata?: { source?: string } }>
          const takes = records.filter((r) => r.metadata?.source === 'recording')
          if (takes.length !== 1) reject(new Error(`Expected one recording, found ${takes.length}`))
          else resolve(takes[0].blob)
        }
      }
    })
    const url = URL.createObjectURL(blob)
    const video = document.createElement('video')
    video.muted = true
    video.preload = 'auto'
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve()
      video.onerror = () => reject(new Error('The stored take would not load in a <video>'))
      video.src = url
    })
    const duration = video.duration
    const target = Number.isFinite(duration) ? duration / 2 : 1
    const seeked = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 10_000)
      video.onseeked = () => {
        clearTimeout(timer)
        resolve(true)
      }
      video.currentTime = target
    })
    const seekedTo = video.currentTime
    URL.revokeObjectURL(url)

    let audioChannels = 0
    let audioSeconds = 0
    const context = new OfflineAudioContext(2, 48_000, 48_000)
    try {
      const audio = await context.decodeAudioData(await blob.arrayBuffer())
      audioChannels = audio.numberOfChannels
      audioSeconds = audio.duration
    } catch {
      // No audio track, or one that will not decode: both read as none.
    }
    return { duration, seeked, seekedTo, audioChannels, audioSeconds, size: blob.size }
  })
}

/**
 * The bytes of the one recording in `video-editor-db`, read out of the page.
 * The callers record exactly one take in a fresh context.
 */
export async function storedRecordingBytes(page: Page): Promise<Uint8Array> {
  const base64 = await page.evaluate(
    () =>
      new Promise<string>((resolve, reject) => {
        const request = indexedDB.open('video-editor-db')
        request.onerror = () => reject(new Error('Failed to open video-editor-db'))
        request.onsuccess = () => {
          const getAll = request.result.transaction('videos', 'readonly').objectStore('videos').getAll()
          getAll.onerror = () => reject(new Error('Failed to read videos store'))
          getAll.onsuccess = async () => {
            const records = getAll.result as Array<{ blob: Blob; metadata?: { source?: string } }>
            const takes = records.filter((r) => r.metadata?.source === 'recording')
            if (takes.length !== 1) return reject(new Error(`Expected one recording, found ${takes.length}`))
            const bytes = new Uint8Array(await takes[0].blob.arrayBuffer())
            let binary = ''
            for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
            resolve(btoa(binary))
          }
        }
      })
  )
  return new Uint8Array(Buffer.from(base64, 'base64'))
}
