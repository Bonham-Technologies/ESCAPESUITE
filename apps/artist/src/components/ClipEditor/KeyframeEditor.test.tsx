import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { KeyframeEditor } from './KeyframeEditor'
import { resetStoreForTest, store, addClip } from '../../test/fixtures/projectStore'
import type { AnimatableProperty, Clip } from '../../store/types'
import styles from './KeyframeEditor.module.css'

const CLIP_DURATION = 4

function keyframesOf(property: AnimatableProperty) {
  return store().project.timeline.clips[0].animation?.keyframes[
    property as keyof NonNullable<Clip['animation']>['keyframes']
  ]
}

/** The block for one property; its name is a child of the header. */
function propertyBlock(name: string): HTMLElement {
  return screen.getByText(name).closest(`.${styles.property}`) as HTMLElement
}

const markersIn = (block: HTMLElement) =>
  Array.from(block.querySelectorAll<HTMLElement>(`.${styles.keyframe}`))

function selectClipWithKeyframe() {
  addClip('clip1', 0, CLIP_DURATION)
  store().setSelectedClipId('clip1')
  store().setClipKeyframe('clip1', 'opacity', { time: 2, value: 0.25, easing: 'linear' })
}

describe('KeyframeEditor', () => {
  beforeEach(() => {
    resetStoreForTest()
  })

  it('renders nothing when no clip is selected', () => {
    const { container } = render(<KeyframeEditor />)

    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing for a clip with no animation', () => {
    addClip('clip1', 0, CLIP_DURATION)
    store().setSelectedClipId('clip1')

    const { container } = render(<KeyframeEditor />)

    expect(container).toBeEmptyDOMElement()
  })

  it('shows the playhead position relative to the clip as a timecode', () => {
    selectClipWithKeyframe()
    store().setCurrentTime(1.5)

    render(<KeyframeEditor />)

    expect(screen.getByText('@0:01:15')).toBeInTheDocument()
  })

  it('clamps the timecode to the clip when the playhead is past its end', () => {
    selectClipWithKeyframe()
    store().setCurrentTime(30)

    render(<KeyframeEditor />)

    expect(screen.getByText('@0:04:00')).toBeInTheDocument()
  })

  it('lists only the properties that carry keyframes', () => {
    selectClipWithKeyframe()

    render(<KeyframeEditor />)

    expect(screen.getByText('Opacity')).toBeInTheDocument()
    expect(screen.queryByText('Rotation')).not.toBeInTheDocument()
  })

  it('counts the keyframes and flags the ones the user made', () => {
    selectClipWithKeyframe()

    render(<KeyframeEditor />)

    const block = propertyBlock('Opacity')
    // The store adds a keyframe at time 0 alongside the one at 2s.
    expect(block).toHaveTextContent('2')
    expect(screen.getByText('Custom')).toBeInTheDocument()
    expect(markersIn(block)).toHaveLength(2)
    expect(markersIn(block).map((m) => m.style.left)).toEqual(['0%', '50%'])
  })

  it('positions the playhead marker inside the track', () => {
    selectClipWithKeyframe()
    store().setCurrentTime(1)

    render(<KeyframeEditor />)

    const playhead = propertyBlock('Opacity').querySelector<HTMLElement>(`.${styles.playhead}`)!
    expect(playhead.style.left).toBe('25%')
  })

  it('adds a keyframe at the playhead with the clip value', async () => {
    const user = userEvent.setup()
    selectClipWithKeyframe()
    store().setCurrentTime(3)
    render(<KeyframeEditor />)

    await user.click(screen.getByTitle('Add keyframe at current time'))

    expect(keyframesOf('opacity')).toEqual([
      { time: 0, value: 1, easing: 'ease-out' },
      { time: 2, value: 0.25, easing: 'linear' },
      { time: 3, value: 1, easing: 'ease-out' },
    ])
  })

  it('starts each property keyframe from that property own clip value', async () => {
    const user = userEvent.setup()
    addClip('clip1', 0, CLIP_DURATION)
    store().setSelectedClipId('clip1')
    store().updateClipTransform('clip1', {
      x: 0.25,
      y: 0.75,
      scaleX: 2,
      scaleY: 3,
      rotation: 45,
      opacity: 0.5,
    })
    store().updateClipEffects('clip1', { blur: 7 })
    const properties: [label: string, property: AnimatableProperty, clipValue: number][] = [
      ['Position X', 'x', 0.25],
      ['Position Y', 'y', 0.75],
      ['Scale X', 'scaleX', 2],
      ['Scale Y', 'scaleY', 3],
      ['Rotation', 'rotation', 45],
      ['Opacity', 'opacity', 0.5],
      ['Blur', 'blur', 7],
    ]
    // One keyframe per property so every property block is on screen.
    for (const [, property] of properties) {
      store().setClipKeyframe('clip1', property, { time: 3, value: 0, easing: 'linear' })
    }
    store().setCurrentTime(1)
    render(<KeyframeEditor />)

    for (const [label, property, clipValue] of properties) {
      const add = propertyBlock(label).querySelector<HTMLElement>(`.${styles.addButton}`)!
      await user.click(add)
      expect(keyframesOf(property)).toContainEqual({ time: 1, value: clipValue, easing: 'ease-out' })
    }
  })

  it('expands and collapses a property from its header', async () => {
    const user = userEvent.setup()
    selectClipWithKeyframe()
    render(<KeyframeEditor />)

    await user.click(markersIn(propertyBlock('Opacity'))[1])
    await user.click(screen.getByText('Opacity'))
    expect(screen.getByText('Easing')).toBeInTheDocument()

    await user.click(screen.getByText('Opacity'))
    expect(screen.queryByText('Easing')).not.toBeInTheDocument()
  })

  it('adding a keyframe does not expand the property on its own', async () => {
    const user = userEvent.setup()
    selectClipWithKeyframe()
    render(<KeyframeEditor />)

    await user.click(screen.getByTitle('Add keyframe at current time'))

    expect(screen.queryByText('Easing')).not.toBeInTheDocument()
  })

  describe('the expanded keyframe editor', () => {
    async function expandSelected(markerIndex = 1) {
      const user = userEvent.setup()
      render(<KeyframeEditor />)
      await user.click(markersIn(propertyBlock('Opacity'))[markerIndex])
      await user.click(screen.getByText('Opacity'))
      return user
    }

    beforeEach(() => {
      selectClipWithKeyframe()
    })

    it('shows the selected keyframe time, value and easing', async () => {
      await expandSelected()

      expect(screen.getByText('0:02:00')).toBeInTheDocument()
      expect(screen.getByRole('spinbutton')).toHaveValue(0.25)
      expect(screen.getByRole('combobox')).toHaveValue('linear')
    })

    it('marks the selected keyframe in the track', async () => {
      await expandSelected()

      expect(markersIn(propertyBlock('Opacity'))[1]).toHaveClass(styles.selected)
    })

    it('writes a new value to the store', async () => {
      await expandSelected()

      fireEvent.change(screen.getByRole('spinbutton'), {
        target: { value: '0.8' },
      })

      expect(keyframesOf('opacity')![1]).toEqual({ time: 2, value: 0.8, easing: 'linear' })
    })

    it('writes a new easing to the store', async () => {
      const user = await expandSelected()

      await user.selectOptions(screen.getByRole('combobox'), 'ease-in-cubic')

      expect(keyframesOf('opacity')![1]).toEqual({
        time: 2,
        value: 0.25,
        easing: 'ease-in-cubic',
      })
    })

    it('removes the keyframe and closes the editor', async () => {
      const user = await expandSelected()

      await user.click(screen.getByRole('button', { name: 'Remove Keyframe' }))

      expect(keyframesOf('opacity')!.map((kf) => kf.time)).toEqual([0])
      expect(screen.queryByText('Remove Keyframe')).not.toBeInTheDocument()
    })
  })

  describe('preset keyframes', () => {
    beforeEach(() => {
      addClip('clip1', 0, CLIP_DURATION)
      store().setSelectedClipId('clip1')
      store().updateClipAnimation('clip1', {
        in: { type: 'fade', duration: 1, easing: 'ease-out' },
      })
    })

    it('shows preset keyframes without the custom badge', () => {
      render(<KeyframeEditor />)

      expect(markersIn(propertyBlock('Opacity'))).toHaveLength(2)
      expect(screen.queryByText('Custom')).not.toBeInTheDocument()
    })

    it('locks the editor and explains why', async () => {
      const user = userEvent.setup()
      render(<KeyframeEditor />)

      await user.click(markersIn(propertyBlock('Opacity'))[1])
      await user.click(screen.getByText('Opacity'))

      expect(screen.getByRole('spinbutton')).toBeDisabled()
      expect(screen.getByRole('combobox')).toBeDisabled()
      expect(screen.queryByRole('button', { name: 'Remove Keyframe' })).not.toBeInTheDocument()
      expect(
        screen.getByText('This keyframe is from a preset animation.')
      ).toBeInTheDocument()
    })
  })
})
