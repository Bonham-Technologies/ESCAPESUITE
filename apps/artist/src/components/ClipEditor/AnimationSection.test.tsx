// The "Animation" section of the clip inspector, rendered on its own so the
// preset guards, the Active badge and the keyframe count can be read directly.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AnimationSection } from './AnimationSection'
import { makeAnimation, inertSliderGesture } from '../../test/fixtures/clipFixtures'
import { ANIMATION_PRESETS, EASING_TYPES } from './clipEditorOptions'
import type { ClipAnimation } from '../../store/types'
import styles from './ClipEditor.module.css'

type Props = React.ComponentProps<typeof AnimationSection>

function renderSection(overrides: Partial<Props> = {}) {
  const handlers = {
    onKeyframePanelToggle: vi.fn(),
    onInTypeChange: vi.fn(),
    onInDurationChange: vi.fn(),
    onInEasingChange: vi.fn(),
    onOutTypeChange: vi.fn(),
    onOutDurationChange: vi.fn(),
    onOutEasingChange: vi.fn(),
  }
  render(
    <AnimationSection
      animation={undefined}
      clipDuration={10}
      keyframePanelOpen={false}
      sliderGesture={inertSliderGesture}
      {...handlers}
      {...overrides}
    />
  )
  return handlers
}

/** Scope queries to one of the two Animate In / Animate Out groups. */
const group = (label: 'Animate In' | 'Animate Out') =>
  within(screen.getByText(label).parentElement as HTMLElement)

const withIn = (over: Partial<ClipAnimation['in']>): ClipAnimation =>
  makeAnimation({ in: { type: 'fade', duration: 0.5, easing: 'ease-out', ...over } })

const withOut = (over: Partial<ClipAnimation['out']>): ClipAnimation =>
  makeAnimation({ out: { type: 'fade', duration: 0.5, easing: 'ease-in', ...over } })

describe('AnimationSection', () => {
  it('offers both groups with the presets in the table order', () => {
    renderSection()

    for (const label of ['Animate In', 'Animate Out'] as const) {
      const select = group(label).getByRole('combobox')
      expect(select).toHaveValue('none')
      expect(
        Array.from(select.querySelectorAll('option')).map((o) => o.textContent)
      ).toEqual(ANIMATION_PRESETS.map((p) => p.label))
    }
  })

  describe('while the preset is none', () => {
    it('hides duration and easing for a clip with no animation at all', () => {
      renderSection()

      expect(screen.queryByText('Duration')).not.toBeInTheDocument()
      expect(screen.queryByText('Easing')).not.toBeInTheDocument()
    })

    it('hides them for an animation whose presets are explicitly none', () => {
      renderSection({ animation: makeAnimation() })

      expect(screen.queryByText('Duration')).not.toBeInTheDocument()
      expect(screen.queryByText('Easing')).not.toBeInTheDocument()
    })

    it('reveals them per group once a preset is chosen', () => {
      renderSection({ animation: withIn({ type: 'pop', duration: 0.8 }) })

      expect(group('Animate In').getByText('Duration')).toBeInTheDocument()
      expect(group('Animate In').getByText('Easing')).toBeInTheDocument()
      expect(group('Animate Out').queryByText('Duration')).not.toBeInTheDocument()
      expect(group('Animate Out').queryByText('Easing')).not.toBeInTheDocument()
    })
  })

  describe('Animate In', () => {
    it('reports a chosen preset', async () => {
      const user = userEvent.setup()
      const { onInTypeChange, onOutTypeChange } = renderSection()

      await user.selectOptions(group('Animate In').getByRole('combobox'), 'slide-left')

      expect(onInTypeChange).toHaveBeenCalledWith('slide-left')
      expect(onOutTypeChange).not.toHaveBeenCalled()
    })

    it('caps the duration slider at half the clip, up to two seconds', () => {
      renderSection({ animation: withIn({ type: 'fade', duration: 0.5 }), clipDuration: 3 })

      const duration = group('Animate In').getByRole('slider')
      expect(duration).toHaveAttribute('min', '0.1')
      expect(duration).toHaveAttribute('max', '1.5')
      expect(duration).toHaveValue('0.5')
      expect(group('Animate In').getByText('0.5s')).toBeInTheDocument()
    })

    it('reports a new duration', () => {
      const { onInDurationChange } = renderSection({ animation: withIn({ type: 'fade' }) })

      fireEvent.change(group('Animate In').getByRole('slider'), { target: { value: '1.2' } })

      expect(onInDurationChange).toHaveBeenCalledWith(1.2)
    })

    it('defaults its easing to ease-out and reports a new one', async () => {
      const user = userEvent.setup()
      const { onInEasingChange } = renderSection({ animation: withIn({ type: 'fade' }) })

      const easing = group('Animate In').getAllByRole('combobox')[1]
      expect(easing).toHaveValue('ease-out')
      expect(Array.from(easing.querySelectorAll('option')).map((o) => o.textContent)).toEqual(
        EASING_TYPES.map((e) => e.label)
      )

      await user.selectOptions(easing, 'ease-in-cubic')

      expect(onInEasingChange).toHaveBeenCalledWith('ease-in-cubic')
    })
  })

  describe('Animate Out', () => {
    it('reports a chosen preset', async () => {
      const user = userEvent.setup()
      const { onOutTypeChange, onInTypeChange } = renderSection()

      await user.selectOptions(group('Animate Out').getByRole('combobox'), 'blur')

      expect(onOutTypeChange).toHaveBeenCalledWith('blur')
      expect(onInTypeChange).not.toHaveBeenCalled()
    })

    it('reports a new duration', () => {
      const { onOutDurationChange } = renderSection({ animation: withOut({ type: 'fade' }) })

      fireEvent.change(group('Animate Out').getByRole('slider'), { target: { value: '0.9' } })

      expect(onOutDurationChange).toHaveBeenCalledWith(0.9)
    })

    it('defaults its easing to ease-in and reports a new one', async () => {
      const user = userEvent.setup()
      const { onOutEasingChange } = renderSection({ animation: withOut({ type: 'fade' }) })

      const easing = group('Animate Out').getAllByRole('combobox')[1]
      expect(easing).toHaveValue('ease-in')

      await user.selectOptions(easing, 'linear')

      expect(onOutEasingChange).toHaveBeenCalledWith('linear')
    })
  })

  describe('the Active badge', () => {
    it('is absent while nothing is animated', () => {
      renderSection({ animation: makeAnimation() })

      expect(screen.queryByText('Active')).not.toBeInTheDocument()
      expect(document.querySelector(`.${styles.animationBadge}`)).toBeNull()
    })

    it('is absent for a preset whose duration is zero', () => {
      // `hasAnimation` wants a preset *and* a non-zero duration, so a preset
      // that runs for no time at all does not count as animated.
      renderSection({ animation: withIn({ type: 'fade', duration: 0 }) })

      expect(screen.queryByText('Active')).not.toBeInTheDocument()
    })

    it('appears once a preset runs for longer than zero', () => {
      renderSection({ animation: withIn({ type: 'fade', duration: 0.5 }) })

      expect(screen.getByText('Active')).toHaveClass(styles.animationBadge)
    })
  })

  describe('the keyframe editor button', () => {
    it('offers to open the panel and reports the click', async () => {
      const user = userEvent.setup()
      const { onKeyframePanelToggle } = renderSection()

      const button = screen.getByRole('button', { name: /Open Keyframe Editor/ })
      expect(button.className).not.toContain(styles.active)

      await user.click(button)

      expect(onKeyframePanelToggle).toHaveBeenCalledTimes(1)
    })

    it('offers to close it again while it is open', () => {
      renderSection({ keyframePanelOpen: true })

      expect(screen.getByRole('button', { name: /Close Keyframe Editor/ }).className).toContain(
        styles.active
      )
    })

    it('counts every keyframe across every animated property', () => {
      renderSection({
        animation: makeAnimation({
          keyframes: {
            x: [
              { time: 0, value: 0, easing: 'linear' },
              { time: 1, value: 1, easing: 'linear' },
            ],
            opacity: [{ time: 0.5, value: 0.5, easing: 'linear' }],
          },
        }),
      })

      const badge = screen.getByText('3')
      expect(badge).toHaveClass(styles.keyframeBadge)
    })

    it('hides the count while the panel is open', () => {
      renderSection({
        keyframePanelOpen: true,
        animation: makeAnimation({ keyframes: { x: [{ time: 0, value: 0, easing: 'linear' }] } }),
      })

      expect(screen.queryByText('1')).not.toBeInTheDocument()
    })
  })
})
