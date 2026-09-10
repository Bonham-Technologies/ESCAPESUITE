import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ClipEditor } from './ClipEditor'
import { resetStoreForTest, store, addClip, video } from '../../test/fixtures/projectStore'
import { rowControl } from '../../test/domQueries'
import type { SourceVideo } from '../../store/types'
import styles from './ClipEditor.module.css'

/** Open (or close) a collapsible section by its title. */
async function toggleSection(user: ReturnType<typeof userEvent.setup>, title: RegExp | string) {
  await user.click(screen.getByRole('button', { name: title }))
}

/** Scope queries to one of the Animate In / Animate Out groups. */
const animationGroup = (label: 'Animate In' | 'Animate Out') =>
  within(screen.getByText(label).parentElement as HTMLElement)

/** Drag a range input to `value` the way a real input event delivers it. */
function slide(input: HTMLInputElement, value: number | string) {
  fireEvent.change(input, { target: { value: String(value) } })
}

const clipNow = () => store().project.timeline.clips[0]

describe('ClipEditor', () => {
  let confirmSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    resetStoreForTest()
    confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
  })

  afterEach(() => {
    confirmSpy.mockRestore()
  })

  describe('with no clip selected', () => {
    it('offers the overlay shortcuts instead of an editor', () => {
      render(<ClipEditor />)

      expect(screen.getByText('Select a clip to edit')).toBeInTheDocument()
      expect(screen.queryByText('Transform')).not.toBeInTheDocument()
    })

    it('adds a text overlay clip', async () => {
      const user = userEvent.setup()
      render(<ClipEditor />)

      await user.click(screen.getByRole('button', { name: 'Add Text' }))

      const clip = clipNow()
      expect(clip.overlayType).toBe('text')
      expect(clip.textData?.text).toBe('Text')
      expect(store().selectedClipId).toBe(clip.id)
    })

    it.each([
      ['Rectangle', 'rectangle'],
      ['Ellipse', 'ellipse'],
      ['Arrow', 'arrow'],
      ['Blur', 'blur'],
    ])('adds a %s shape overlay clip', async (button, type) => {
      const user = userEvent.setup()
      render(<ClipEditor />)

      await user.click(screen.getByRole('button', { name: button }))

      const clip = clipNow()
      expect(clip.overlayType).toBe('shape')
      expect(clip.shapeData?.type).toBe(type)
    })

    it('gives a blur region a transparent fill and a blur amount', async () => {
      const user = userEvent.setup()
      render(<ClipEditor />)

      await user.click(screen.getByRole('button', { name: 'Blur' }))

      expect(clipNow().shapeData).toMatchObject({ fillColor: '#00000000', blurAmount: 10 })
    })
  })

  describe('header and info', () => {
    beforeEach(() => {
      addClip('clip1', 3, 4)
      store().setSelectedClipId('clip1')
    })

    it('names the clip and calls it a video clip', () => {
      render(<ClipEditor />)

      expect(screen.getByText('Video Clip')).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'clip1' })).toBeInTheDocument()
    })

    it('shows the clip duration, timeline position and track', () => {
      render(<ClipEditor />)

      const track = store().project.timeline.tracks[0]
      expect(screen.getByText('00:04.000')).toBeInTheDocument()
      expect(screen.getByText('00:03.000')).toBeInTheDocument()
      expect(screen.getByText(track.name)).toBeInTheDocument()
    })

    it('deletes the clip once the confirm is accepted', async () => {
      const user = userEvent.setup()
      render(<ClipEditor />)

      await user.click(screen.getByTitle('Delete clip'))

      expect(confirmSpy).toHaveBeenCalledWith('Delete clip "clip1"?')
      expect(store().project.timeline.clips).toHaveLength(0)
    })

    it('keeps the clip when the confirm is declined', async () => {
      confirmSpy.mockReturnValue(false)
      const user = userEvent.setup()
      render(<ClipEditor />)

      await user.click(screen.getByTitle('Delete clip'))

      expect(store().project.timeline.clips).toHaveLength(1)
    })

    it('collapses a section so its controls go away', async () => {
      const user = userEvent.setup()
      render(<ClipEditor />)

      expect(screen.getByText('Pos X')).toBeInTheDocument()
      await toggleSection(user, 'Transform')

      expect(screen.queryByText('Pos X')).not.toBeInTheDocument()
    })
  })

  describe('clip type labels', () => {
    const mediaClip = (media: Partial<SourceVideo>) => {
      store().addSourceVideo({ ...video, id: 'media2', ...media } as SourceVideo)
      store().addClipToTimeline(
        { id: 'clip1', sourceVideoId: 'media2', name: 'clip1', startTime: 0, endTime: 2, duration: 2 },
        undefined,
        0
      )
      store().setSelectedClipId('clip1')
    }

    it('labels an image clip', () => {
      mediaClip({ mediaType: 'image' })
      render(<ClipEditor />)

      expect(screen.getByText('Image')).toBeInTheDocument()
    })

    it('labels an audio clip and drops its visual sections', () => {
      mediaClip({ mediaType: 'audio' })
      render(<ClipEditor />)

      expect(screen.getByText('Audio')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Transform' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Blend Mode' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Animation/ })).not.toBeInTheDocument()
      // A transition and a split still make sense for audio
      expect(screen.getByRole('button', { name: 'Transition Out' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Split' })).toBeInTheDocument()
    })
  })

  describe('transform', () => {
    beforeEach(() => {
      addClip('clip1', 0, 4)
      store().setSelectedClipId('clip1')
    })

    it('moves the clip horizontally and vertically', () => {
      render(<ClipEditor />)

      slide(rowControl('Pos X'), 0.25)
      slide(rowControl('Pos Y'), 0.75)

      expect(clipNow().transform).toMatchObject({ x: 0.25, y: 0.75 })
    })

    it('changes both scale axes together while the aspect ratio is locked', () => {
      render(<ClipEditor />)

      slide(rowControl('Scale'), 1.5)

      expect(clipNow().transform).toMatchObject({ scaleX: 1.5, scaleY: 1.5 })
    })

    it('unlocks the aspect ratio and scales each axis on its own', async () => {
      const user = userEvent.setup()
      render(<ClipEditor />)

      await user.click(screen.getByTitle('Unlock aspect ratio'))
      expect(clipNow().transform.scaleLocked).toBe(false)

      slide(rowControl('Scale X'), 1.2)
      slide(rowControl('Scale Y'), 0.4)

      expect(clipNow().transform).toMatchObject({ scaleX: 1.2, scaleY: 0.4 })
    })

    it('re-locks the aspect ratio', async () => {
      const user = userEvent.setup()
      render(<ClipEditor />)

      await user.click(screen.getByTitle('Unlock aspect ratio'))
      await user.click(screen.getByTitle('Lock aspect ratio'))

      expect(clipNow().transform.scaleLocked).toBe(true)
    })

    it('changes opacity', () => {
      render(<ClipEditor />)

      slide(rowControl('Opacity'), 0.3)

      expect(clipNow().transform.opacity).toBeCloseTo(0.3)
    })

    it('scales the clip to fit the project canvas', async () => {
      const user = userEvent.setup()
      store().setProjectResolution(1280, 720)
      render(<ClipEditor />)

      await user.click(screen.getByRole('button', { name: 'Fit to Canvas' }))

      // 1280/1920 and 720/1080 are both 2/3, so that is the fit scale
      expect(clipNow().transform.scaleX).toBeCloseTo(2 / 3)
      expect(clipNow().transform.scaleY).toBeCloseTo(2 / 3)
    })

    it('resets position, scale and opacity from the section header', async () => {
      const user = userEvent.setup()
      store().updateClipTransform('clip1', { x: 0.1, y: 0.2, scaleX: 1.7, scaleY: 1.7, opacity: 0.4 })
      render(<ClipEditor />)

      const headerReset = screen
        .getAllByRole('button', { name: 'Reset' })
        .find((button) => !button.getAttribute('title'))!
      await user.click(headerReset)

      expect(clipNow().transform).toMatchObject({ x: 0.5, y: 0.5, scaleX: 1, scaleY: 1, opacity: 1 })
    })

    it('restores the whole default transform from the scale reset', async () => {
      const user = userEvent.setup()
      store().updateClipTransform('clip1', { scaleLocked: false, scaleX: 1.9 })
      render(<ClipEditor />)

      await user.click(screen.getByTitle('Reset position, scale, and rotation to defaults'))

      expect(clipNow().transform).toMatchObject({ scaleX: 1, scaleY: 1, rotation: 0, scaleLocked: true })
    })

    it('hides the scale controls for a clip with no source media', async () => {
      const user = userEvent.setup()
      render(<ClipEditor />)
      await user.click(screen.getByTitle('Delete clip'))

      await user.click(screen.getByRole('button', { name: 'Add Text' }))

      expect(screen.queryByTitle('Unlock aspect ratio')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Fit to Canvas' })).not.toBeInTheDocument()
    })
  })

  describe('blend mode and effects', () => {
    beforeEach(() => {
      addClip('clip1', 0, 4)
      store().setSelectedClipId('clip1')
    })

    it('changes the blend mode', async () => {
      const user = userEvent.setup()
      render(<ClipEditor />)

      await toggleSection(user, 'Blend Mode')
      const blendSection = screen.getByRole('button', { name: 'Blend Mode' }).closest(`.${styles.section}`)!
      await user.selectOptions(within(blendSection as HTMLElement).getByRole('combobox'), 'multiply')

      expect(clipNow().blendMode).toBe('multiply')
    })

    it('changes the blur effect', async () => {
      const user = userEvent.setup()
      render(<ClipEditor />)

      await toggleSection(user, 'Effects')
      slide(rowControl('Blur'), 12.5)

      expect(clipNow().effects?.blur).toBe(12.5)
      expect(screen.getByText('12.5px')).toBeInTheDocument()
    })
  })

  describe('animation presets', () => {
    beforeEach(() => {
      addClip('clip1', 0, 4)
      store().setSelectedClipId('clip1')
    })

    it('sets the animate-in preset, duration and easing', async () => {
      const user = userEvent.setup()
      render(<ClipEditor />)

      const group = animationGroup('Animate In')
      await user.selectOptions(group.getAllByRole('combobox')[0], 'slide-left')
      expect(clipNow().animation?.in).toMatchObject({ type: 'slide-left', duration: 0.5, easing: 'ease-out' })

      slide(animationGroup('Animate In').getByRole('slider'), 1.2)
      expect(clipNow().animation?.in.duration).toBeCloseTo(1.2)

      await user.selectOptions(animationGroup('Animate In').getAllByRole('combobox')[1], 'ease-in-cubic')
      expect(clipNow().animation?.in.easing).toBe('ease-in-cubic')
    })

    it('sets the animate-out preset, duration and easing', async () => {
      const user = userEvent.setup()
      render(<ClipEditor />)

      await user.selectOptions(animationGroup('Animate Out').getAllByRole('combobox')[0], 'pop')
      expect(clipNow().animation?.out).toMatchObject({ type: 'pop', duration: 0.5, easing: 'ease-in' })

      slide(animationGroup('Animate Out').getByRole('slider'), 0.9)
      expect(clipNow().animation?.out.duration).toBeCloseTo(0.9)

      await user.selectOptions(animationGroup('Animate Out').getAllByRole('combobox')[1], 'linear')
      expect(clipNow().animation?.out.easing).toBe('linear')
    })

    it('hides the duration and easing rows while the preset is none', () => {
      render(<ClipEditor />)

      expect(animationGroup('Animate In').queryByRole('slider')).not.toBeInTheDocument()
      expect(animationGroup('Animate Out').queryByRole('slider')).not.toBeInTheDocument()
    })

    it('badges the section once the clip animates', async () => {
      const user = userEvent.setup()
      render(<ClipEditor />)

      expect(screen.queryByText('Active')).not.toBeInTheDocument()

      await user.selectOptions(animationGroup('Animate In').getAllByRole('combobox')[0], 'fade')

      expect(screen.getByText('Active')).toHaveClass(styles.animationBadge)
    })

    it('opens and closes the keyframe editor', async () => {
      const user = userEvent.setup()
      render(<ClipEditor />)

      await user.click(screen.getByRole('button', { name: /Open Keyframe Editor/ }))
      expect(store().keyframePanelState.isOpen).toBe(true)

      await user.click(screen.getByRole('button', { name: /Close Keyframe Editor/ }))
      expect(store().keyframePanelState.isOpen).toBe(false)
    })

    it('counts the clip keyframes on the closed editor button', () => {
      store().updateClipAnimation('clip1', {
        keyframes: {
          opacity: [
            { time: 0, value: 0, easing: 'linear' },
            { time: 1, value: 1, easing: 'linear' },
          ],
          x: [{ time: 0, value: 0.5, easing: 'linear' }],
        },
      })
      render(<ClipEditor />)

      expect(screen.getByText('3')).toHaveClass(styles.keyframeBadge)
    })
  })

  describe('transitions', () => {
    beforeEach(() => {
      addClip('clip1', 0, 4)
      store().setSelectedClipId('clip1')
    })

    it('sets the transition type and then its duration', async () => {
      const user = userEvent.setup()
      render(<ClipEditor />)

      await toggleSection(user, 'Transition Out')
      expect(screen.queryByText('Duration')).not.toBeInTheDocument()

      await user.selectOptions(rowControl('Type', 'select'), 'wipe-left')
      expect(clipNow().transition?.type).toBe('wipe-left')

      slide(rowControl('Duration'), 1.5)
      expect(clipNow().transition?.duration).toBeCloseTo(1.5)
    })
  })

  describe('actions', () => {
    beforeEach(() => {
      addClip('clip1', 3, 4)
      store().setSelectedClipId('clip1')
    })

    it('moves the playhead to the clip start', async () => {
      const user = userEvent.setup()
      render(<ClipEditor />)

      await user.click(screen.getByRole('button', { name: 'Go to' }))

      expect(store().currentTime).toBe(3)
    })

    it('duplicates the clip', async () => {
      const user = userEvent.setup()
      render(<ClipEditor />)

      await user.click(screen.getByRole('button', { name: 'Duplicate' }))

      expect(store().project.timeline.clips).toHaveLength(2)
    })

    it('cannot split while the playhead is outside the clip', () => {
      render(<ClipEditor />)

      expect(screen.getByRole('button', { name: 'Split' })).toBeDisabled()
    })

    it('splits the clip at the playhead', async () => {
      const user = userEvent.setup()
      store().setCurrentTime(4)
      render(<ClipEditor />)

      await user.click(screen.getByRole('button', { name: 'Split' }))

      const durations = store().project.timeline.clips.map((c) => c.duration)
      expect(durations).toEqual([1, 3])
    })
  })
})
