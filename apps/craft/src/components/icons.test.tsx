// The icon set, drawn one at a time.
//
// Icons are pure geometry, so what is worth pinning is what the rest of the UI
// depends on: the `viewBox` every one of them shares, whether an icon is
// stroked or filled, that the six source icons forward a `className` (and
// survive without one), and that the action icons are hidden from screen
// readers — their buttons carry the label.
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import {
  ScreenIcon,
  WebcamIcon,
  MicIcon,
  SpeakerIcon,
  UnavailableIcon,
  RecordIcon,
  PauseIcon,
  PlayIcon,
  CloseIcon,
  EditIcon,
  TrashIcon,
  DownloadIcon,
  UploadIcon,
} from './icons'

function draw(element: ReactElement): SVGSVGElement {
  const { container } = render(element)
  return container.querySelector('svg') as SVGSVGElement
}

const classNameIcons: Array<[string, (props: { className?: string }) => ReactElement]> = [
  ['ScreenIcon', ScreenIcon],
  ['WebcamIcon', WebcamIcon],
  ['MicIcon', MicIcon],
  ['SpeakerIcon', SpeakerIcon],
  ['UnavailableIcon', UnavailableIcon],
  ['RecordIcon', RecordIcon],
]

const actionIcons: Array<[string, () => ReactElement]> = [
  ['PauseIcon', PauseIcon],
  ['PlayIcon', PlayIcon],
  ['CloseIcon', CloseIcon],
  ['EditIcon', EditIcon],
  ['TrashIcon', TrashIcon],
  ['DownloadIcon', DownloadIcon],
  ['UploadIcon', UploadIcon],
]

describe('source icons', () => {
  it.each(classNameIcons)('%s forwards the class it is given', (_name, Icon) => {
    const svg = draw(<Icon className="sourceIcon" />)

    expect(svg).toHaveClass('sourceIcon')
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24')
  })

  it.each(classNameIcons)('%s draws without a class', (_name, Icon) => {
    const svg = draw(<Icon />)

    expect(svg.getAttribute('class')).toBeNull()
  })

  it('strokes the four capture-source icons and fills the record dot', () => {
    expect(draw(<ScreenIcon />)).toHaveAttribute('stroke', 'currentColor')
    expect(draw(<WebcamIcon />)).toHaveAttribute('stroke', 'currentColor')
    expect(draw(<MicIcon />)).toHaveAttribute('stroke', 'currentColor')
    expect(draw(<SpeakerIcon />)).toHaveAttribute('stroke', 'currentColor')
    expect(draw(<UnavailableIcon />)).toHaveAttribute('stroke', 'currentColor')
    expect(draw(<RecordIcon />)).toHaveAttribute('fill', 'currentColor')
  })

  it('draws the screen as a monitor on a stand', () => {
    const svg = draw(<ScreenIcon />)

    expect(svg.querySelector('rect')).toHaveAttribute('width', '20')
    expect(svg.querySelectorAll('line')).toHaveLength(2)
  })

  it('crosses the unavailable icon through its circle', () => {
    const svg = draw(<UnavailableIcon />)

    expect(svg.querySelector('circle')).toHaveAttribute('r', '10')
    expect(svg.querySelector('line')).toHaveAttribute('x1', '4.93')
  })
})

describe('action icons', () => {
  it.each(actionIcons)('%s is hidden from assistive technology', (_name, Icon) => {
    const svg = draw(<Icon />)

    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24')
  })

  it('fills pause and play, and strokes the rest', () => {
    expect(draw(<PauseIcon />)).toHaveAttribute('fill', 'currentColor')
    expect(draw(<PlayIcon />)).toHaveAttribute('fill', 'currentColor')
    expect(draw(<CloseIcon />)).toHaveAttribute('stroke', 'currentColor')
    expect(draw(<EditIcon />)).toHaveAttribute('stroke', 'currentColor')
    expect(draw(<TrashIcon />)).toHaveAttribute('stroke', 'currentColor')
    expect(draw(<DownloadIcon />)).toHaveAttribute('stroke', 'currentColor')
    expect(draw(<UploadIcon />)).toHaveAttribute('stroke', 'currentColor')
  })

  it('points the upload arrow the opposite way from the download arrow', () => {
    // The two sit in the same row of buttons, so the only thing telling them
    // apart at a glance is which way the arrow goes.
    expect(draw(<DownloadIcon />).querySelector('polyline')).toHaveAttribute('points', '7 10 12 15 17 10')
    expect(draw(<UploadIcon />).querySelector('polyline')).toHaveAttribute('points', '17 8 12 3 7 8')
  })

  it('draws pause as two bars and play as one triangle', () => {
    expect(draw(<PauseIcon />).querySelectorAll('rect')).toHaveLength(2)
    expect(draw(<PlayIcon />).querySelector('polygon')).toHaveAttribute('points', '5 3 19 12 5 21 5 3')
  })
})
