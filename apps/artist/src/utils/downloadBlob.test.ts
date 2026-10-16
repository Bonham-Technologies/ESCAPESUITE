// The one browser download hand-off (ESCSUITE-293): the export dialog's video
// and its caption sidecars both go through it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { downloadBlob } from './downloadBlob'
import { lastObjectUrl } from '../test/objectUrls'

describe('downloadBlob', () => {
  let clicked: { href: string; download: string; attached: boolean }[]
  let originalClick: () => void

  beforeEach(() => {
    vi.clearAllMocks()
    clicked = []
    originalClick = HTMLAnchorElement.prototype.click
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      clicked.push({ href: this.href, download: this.download, attached: document.body.contains(this) })
    }
  })

  afterEach(() => {
    HTMLAnchorElement.prototype.click = originalClick
  })

  it('clicks a download link to an object URL for the blob, under the name given', () => {
    const blob = new Blob(['bytes'], { type: 'text/plain' })

    downloadBlob(blob, 'My Project.srt')

    expect(URL.createObjectURL).toHaveBeenCalledWith(blob)
    expect(clicked).toEqual([{ href: lastObjectUrl(), download: 'My Project.srt', attached: true }])
  })

  it('leaves nothing behind: the link is gone and the URL revoked', () => {
    downloadBlob(new Blob(['x']), 'a.vtt')

    expect(document.querySelector('a[download]')).toBeNull()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(lastObjectUrl())
  })
})
