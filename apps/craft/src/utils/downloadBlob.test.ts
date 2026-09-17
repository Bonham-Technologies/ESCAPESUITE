// The one way ESCAPECRAFT hands a blob to the browser as a file.
//
// Both download paths — the instant WebM and the converted MP4 — go through
// this helper, so what is pinned here is the anchor it builds, that the anchor
// is gone again afterwards, and the deferred revoke that keeps the download
// alive outside Chrome.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { downloadBlob } from './downloadBlob'

let clicks: Array<{ href: string; download: string; inDocument: boolean }>

beforeEach(() => {
  clicks = []
  vi.mocked(URL.createObjectURL).mockClear()
  vi.mocked(URL.revokeObjectURL).mockClear()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement
  ) {
    clicks.push({
      href: this.getAttribute('href') ?? '',
      download: this.download,
      inDocument: this.isConnected,
    })
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('downloadBlob', () => {
  it('clicks an anchor that is in the document, under the name it was given', () => {
    downloadBlob(new Blob(['bytes']), 'standup_demo.mp4')

    expect(clicks).toEqual([
      { href: 'blob:mock-url', download: 'standup_demo.mp4', inDocument: true },
    ])
  })

  it('leaves no anchor behind', () => {
    downloadBlob(new Blob(['bytes']), 'take.webm')

    expect(document.querySelector('a[download]')).toBeNull()
  })

  it('revokes the object URL a turn later, not in the click tick', async () => {
    vi.useFakeTimers()
    try {
      downloadBlob(new Blob(['bytes']), 'take.webm')

      // Revoking in the same tick as click() cancels the download outside
      // Chrome — the browser has not necessarily started reading the blob yet.
      expect(URL.revokeObjectURL).not.toHaveBeenCalled()

      vi.advanceTimersByTime(0)
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
    } finally {
      vi.useRealTimers()
    }
  })
})
