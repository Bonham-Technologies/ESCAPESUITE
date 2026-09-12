// The `current / total` readout in the timeline's info bar. It subscribes to
// currentTime itself — see TimelinePlayhead.test.tsx for the test that pins why.
import { describe, it, expect, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { TimelineTimeReadout } from './TimelineTimeReadout'
import { resetStoreForTest, store } from '../../test/fixtures/projectStore'

describe('TimelineTimeReadout', () => {
  beforeEach(() => {
    resetStoreForTest()
  })

  it('reads out the playhead against the timeline duration', () => {
    store().setCurrentTime(65)
    const { container } = render(<TimelineTimeReadout duration={125} />)

    expect(container.textContent).toBe('1:05 / 2:05')
  })

  it('starts at zero', () => {
    const { container } = render(<TimelineTimeReadout duration={0} />)

    expect(container.textContent).toBe('0:00 / 0:00')
  })

  it('follows the store without new props', () => {
    const { container } = render(<TimelineTimeReadout duration={10} />)
    expect(container.textContent).toBe('0:00 / 0:10')

    store().setCurrentTime(4)

    expect(container.textContent).toBe('0:04 / 0:10')
  })
})
