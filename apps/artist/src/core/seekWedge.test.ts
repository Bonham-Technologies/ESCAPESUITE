// The seek-wedge rule's own pieces (ESCSUITE-305, ESCSUITE-370, ESCSUITE-412).
// The element exporters' suites cover the rule end to end; these pin the copy
// the refusal speaks in each engine and the diagnostic line each seek request
// writes, which a console read from a CI trace has to be able to diagnose a
// wedge from.
import { describe, expect, it } from 'vitest'
import {
  SourceNotSeekableError,
  WEDGED_SEEK_FRAMES,
  describeSeekRequest,
  nextWedgeCount,
  sourceNotSeekableMessage,
} from './seekWedge'

const CHROMIUM = {
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36',
  userAgentData: { brands: [{ brand: 'Chromium' }, { brand: 'Google Chrome' }] },
}
const FIREFOX = { userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:157.0) Gecko/20100101 Firefox/157.0' }

/** An element in the state the wedge count reads. */
function element(seeking: boolean, readyState: number): HTMLVideoElement {
  return { seeking, readyState } as HTMLVideoElement
}

describe('the refusal', () => {
  it('tells a Chromium user what to do in Chromium, not to export in Chrome or Edge', () => {
    const message = sourceNotSeekableMessage('take.webm', CHROMIUM)

    expect(message).toBe(
      'This browser cannot read "take.webm" frame by frame (its seeks never completed, even after reloading it). Convert it to MP4 (ESCAPECRAFT\'s MP4 download does) and import that instead.'
    )
    expect(message).not.toMatch(/Chrome or Edge/)
  })

  it('still sends a Firefox user to Chrome or Edge, whose seeks the Firefox wedge does not reach', () => {
    expect(sourceNotSeekableMessage('take.webm', FIREFOX)).toBe(
      'This browser cannot read "take.webm" frame by frame (its seeks never completed). Re-save the recording in ESCAPECRAFT, or export in Chrome or Edge.'
    )
  })

  it('reads the engine it runs in when it is given none', () => {
    const error = new SourceNotSeekableError('take.webm')

    expect(error.message).toBe(sourceNotSeekableMessage('take.webm', globalThis.navigator))
    expect(new SourceNotSeekableError('take.webm', CHROMIUM).message).toBe(
      sourceNotSeekableMessage('take.webm', CHROMIUM)
    )
    expect(error).toMatchObject({ code: 'SOURCE_NOT_SEEKABLE', name: 'SourceNotSeekableError' })
  })
})

describe('nextWedgeCount', () => {
  it('counts a request that ends still seeking with no frame, and never throws at the limit', () => {
    expect(nextWedgeCount(WEDGED_SEEK_FRAMES - 1, element(true, 1), false)).toBe(WEDGED_SEEK_FRAMES)
  })

  it('starts again on a seek that landed or an element with a frame', () => {
    expect(nextWedgeCount(2, element(true, 1), true)).toBe(0)
    expect(nextWedgeCount(2, element(true, 2), false)).toBe(0)
  })

  it('leaves the count on an element no longer seeking with no frame yet', () => {
    expect(nextWedgeCount(2, element(false, 1), false)).toBe(2)
  })
})

describe('describeSeekRequest', () => {
  it('writes the target, what became of the seek, the element state and the time it took', () => {
    expect(
      describeSeekRequest('e2e-recording.webm', 0, {
        target: 2.0667666,
        issued: true,
        landed: false,
        seeking: true,
        readyState: 1,
        elapsedMs: 2803.4,
        wedged: 2,
      })
    ).toBe(
      '"e2e-recording.webm" element 0, seek to 2.0668 s: never landed after 2803 ms (seeking=true, readyState=1, wedged 2/3)'
    )
  })

  it('tells a late seek that landed from one that never did', () => {
    expect(
      describeSeekRequest('take.webm', 1, {
        target: 10,
        issued: true,
        landed: true,
        seeking: false,
        readyState: 4,
        elapsedMs: 612,
        wedged: 0,
      })
    ).toBe('"take.webm" element 1, seek to 10.0000 s: landed after 612 ms (seeking=false, readyState=4, wedged 0/3)')
  })

  it('tells a seek that settled with no seeked event in its waits from a wedge', () => {
    expect(
      describeSeekRequest('take.webm', 0, {
        target: 1,
        issued: true,
        landed: false,
        seeking: false,
        readyState: 4,
        elapsedMs: 800,
        wedged: 0,
      })
    ).toContain('seek to 1.0000 s: no seeked event in its waits after 800 ms (seeking=false, readyState=4')
  })

  it('says so when the request issued no seek, as a held transition clip does', () => {
    expect(
      describeSeekRequest('incoming.webm', 0, {
        target: 0.2501,
        issued: false,
        landed: false,
        seeking: true,
        readyState: 1,
        elapsedMs: 2300,
        wedged: 2,
      })
    ).toContain('seek to 0.2501 s: no seek issued after 2300 ms')
  })
})
