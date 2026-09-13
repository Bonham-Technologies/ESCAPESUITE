// The ruler's own DOM, rendered from props alone — no store, no Timeline.
//
// Where the ticks land is timelineGeometry's business (and its tests'); what is
// asserted here is that this component draws what the geometry says, and that a
// click, a double-click on a marker and a grab of an in/out handle reach the
// callbacks the timeline hands it.
import { describe, it, expect, vi } from 'vitest'
import { createRef } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { TimelineMarkerLines, TimelineRuler } from './TimelineRuler'
import { RULER_MAJOR_INTERVAL, RULER_MINOR_INTERVAL } from './timelineGeometry'
import type { Marker } from '../../store/types'
import styles from './Timeline.module.css'

/** The timeline's default scale: one second is 50px at zoom 1. */
const PPS = 50
const DURATION = 10

const marker: Marker = { id: 'm1', time: 3, label: 'Cut here', color: '#ff0000' }

function renderRuler(props: Partial<Parameters<typeof TimelineRuler>[0]> = {}) {
  const { container } = render(
    <TimelineRuler
      rulerRef={createRef<HTMLDivElement>()}
      duration={DURATION}
      pixelsPerSecond={PPS}
      width={DURATION * PPS}
      markers={[]}
      inPoint={null}
      outPoint={null}
      onRulerClick={() => {}}
      onRemoveMarker={() => {}}
      onInPointMouseDown={() => {}}
      onOutPointMouseDown={() => {}}
      {...props}
    />
  )
  return container.firstElementChild as HTMLElement
}

describe('TimelineRuler ticks', () => {
  it('draws a tick per minor interval at its pixel position', () => {
    const root = renderRuler()

    const ticks = root.querySelectorAll(`.${styles.tick}`)
    expect(ticks).toHaveLength(DURATION / RULER_MINOR_INTERVAL + 1)
    expect(ticks[0]).toHaveStyle({ left: '0px' })
    expect(ticks[1]).toHaveStyle({ left: `${RULER_MINOR_INTERVAL * PPS}px` })
    expect(ticks[ticks.length - 1]).toHaveStyle({ left: `${DURATION * PPS}px` })
  })

  it('labels the major ticks only', () => {
    const root = renderRuler()

    const labels = [...root.querySelectorAll(`.${styles.tickLabel}`)].map((el) => el.textContent)
    expect(labels).toEqual(['0:00', '0:05', '0:10'])
    expect(root.querySelectorAll(`.${styles.tickMajor}`)).toHaveLength(
      DURATION / RULER_MAJOR_INTERVAL + 1
    )
    expect(root.querySelectorAll(`.${styles.tickMinor}`)).toHaveLength(
      DURATION / RULER_MINOR_INTERVAL - DURATION / RULER_MAJOR_INTERVAL
    )
  })

  it('scales with the zoom and takes its content width from the caller', () => {
    const root = renderRuler({ pixelsPerSecond: PPS * 2, width: DURATION * PPS * 2 })

    expect(root.querySelector(`.${styles.rulerContent}`)).toHaveStyle({ width: '1000px' })
    expect(root.querySelectorAll(`.${styles.tick}`)[1]).toHaveStyle({ left: '100px' })
  })

  it('hands the scroll box back through the ref it was given', () => {
    const rulerRef = createRef<HTMLDivElement>()
    const root = renderRuler({ rulerRef })

    expect(rulerRef.current).toBe(root.querySelector(`.${styles.ruler}`))
    expect(rulerRef.current).toHaveAttribute('aria-label', 'Timeline ruler')
  })

  it('reports a click on the ruler to the seek handler', () => {
    const onRulerClick = vi.fn()
    const root = renderRuler({ onRulerClick })

    fireEvent.click(root.querySelector(`.${styles.ruler}`)!, { clientX: 250 })

    expect(onRulerClick).toHaveBeenCalledTimes(1)
    expect(onRulerClick.mock.calls[0][0].clientX).toBe(250)
  })
})

describe('TimelineRuler markers', () => {
  it('flags a marker at its time, in its own colour', () => {
    renderRuler({ markers: [marker] })

    const flag = screen.getByTitle('Cut here (0:03) - Double-click to remove')
    expect(flag).toHaveStyle({ left: `${marker.time * PPS}px` })
    expect(flag.style.getPropertyValue('--marker-color')).toBe(marker.color)
    expect(flag.querySelector(`.${styles.markerFlagHead}`)).not.toBeNull()
  })

  it('asks for a marker to be removed when its flag is double-clicked', () => {
    const onRemoveMarker = vi.fn()
    renderRuler({ markers: [marker], onRemoveMarker })

    fireEvent.doubleClick(screen.getByTitle(/^Cut here/))

    expect(onRemoveMarker).toHaveBeenCalledWith(marker.id)
  })
})

describe('TimelineRuler in and out points', () => {
  it('draws neither handle nor region while both points are unset', () => {
    const root = renderRuler()

    expect(root.querySelectorAll(`.${styles.inOutMarker}`)).toHaveLength(0)
    expect(root.querySelectorAll(`.${styles.inOutRulerRegion}`)).toHaveLength(0)
  })

  it('draws each handle at its time and the region between them', () => {
    const root = renderRuler({ inPoint: 2, outPoint: 6 })

    expect(screen.getByTitle('In point: 0:02')).toHaveStyle({ left: '100px' })
    expect(screen.getByTitle('Out point: 0:06')).toHaveStyle({ left: '300px' })
    expect(screen.getByText('I')).toHaveClass(styles.inMarkerHead)
    expect(screen.getByText('O')).toHaveClass(styles.outMarkerHead)
    expect(root.querySelector(`.${styles.inOutRulerRegion}`)).toHaveStyle({
      left: '100px',
      width: '200px',
    })
  })

  it('leaves the region out until both points are set', () => {
    const root = renderRuler({ inPoint: 2, outPoint: null })

    expect(root.querySelectorAll(`.${styles.inOutMarker}`)).toHaveLength(1)
    expect(root.querySelectorAll(`.${styles.inOutRulerRegion}`)).toHaveLength(0)
  })

  it('reports a grab of either handle to its drag handler', () => {
    const onInPointMouseDown = vi.fn()
    const onOutPointMouseDown = vi.fn()
    renderRuler({ inPoint: 2, outPoint: 6, onInPointMouseDown, onOutPointMouseDown })

    fireEvent.mouseDown(screen.getByTitle('In point: 0:02'))
    fireEvent.mouseDown(screen.getByTitle('Out point: 0:06'))

    expect(onInPointMouseDown).toHaveBeenCalledTimes(1)
    expect(onOutPointMouseDown).toHaveBeenCalledTimes(1)
  })
})

describe('TimelineMarkerLines', () => {
  it('drops a line through the tracks for every marker', () => {
    const second: Marker = { id: 'm2', time: 8, label: 'End', color: '#00ff00' }
    const { container } = render(
      <TimelineMarkerLines markers={[marker, second]} pixelsPerSecond={PPS} />
    )

    const lines = container.querySelectorAll(`.${styles.markerLine}`)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toHaveStyle({ left: `${marker.time * PPS}px` })
    expect((lines[1] as HTMLElement).style.getPropertyValue('--marker-color')).toBe(second.color)
  })

  it('draws nothing when there are no markers', () => {
    const { container } = render(<TimelineMarkerLines markers={[]} pixelsPerSecond={PPS} />)

    expect(container.querySelectorAll(`.${styles.markerLine}`)).toHaveLength(0)
  })
})
