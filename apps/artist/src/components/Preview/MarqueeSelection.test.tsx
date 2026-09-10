import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { MarqueeSelection } from './MarqueeSelection'
import styles from './MarqueeSelection.module.css'

function box(container: HTMLElement): HTMLElement {
  return container.querySelector<HTMLElement>(`.${styles.marquee}`)!
}

describe('MarqueeSelection', () => {
  it('spans from the start corner to the current corner when dragged right and down', () => {
    const { container } = render(
      <MarqueeSelection startX={10} startY={20} currentX={110} currentY={70} />
    )

    const rect = box(container)
    expect(rect.style.left).toBe('10px')
    expect(rect.style.top).toBe('20px')
    expect(rect.style.width).toBe('100px')
    expect(rect.style.height).toBe('50px')
  })

  it('normalises a drag that runs up and to the left', () => {
    // The pointer started at the bottom-right corner: the box must still be
    // anchored at the smaller coordinate with a positive size.
    const { container } = render(
      <MarqueeSelection startX={110} startY={70} currentX={10} currentY={20} />
    )

    const rect = box(container)
    expect(rect.style.left).toBe('10px')
    expect(rect.style.top).toBe('20px')
    expect(rect.style.width).toBe('100px')
    expect(rect.style.height).toBe('50px')
  })

  it('collapses to a zero-size box when the pointer has not moved', () => {
    const { container } = render(
      <MarqueeSelection startX={42} startY={7} currentX={42} currentY={7} />
    )

    const rect = box(container)
    expect(rect.style.left).toBe('42px')
    expect(rect.style.top).toBe('7px')
    expect(rect.style.width).toBe('0px')
    expect(rect.style.height).toBe('0px')
  })
})
