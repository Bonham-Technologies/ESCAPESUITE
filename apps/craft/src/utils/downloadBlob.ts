// Handing a blob to the browser as a file.
//
// Both download paths go through here — the instant WebM straight out of
// storage and the MP4 the converter just produced — so the anchor dance and
// the deferred revoke are written once.
import { createBlobUrl, revokeBlobUrl } from '../core/storage'

/**
 * Download `blob` under `filename`, which is used verbatim — the caller has
 * already made it filesystem-safe and given it its extension.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = createBlobUrl(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // Revoking in the same tick as click() cancels the download outside Chrome:
  // the browser has not necessarily started reading the blob yet. One turn of
  // the event loop is enough for it to have taken hold.
  setTimeout(() => revokeBlobUrl(url), 0)
}
