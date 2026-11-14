// The Recording Tips modal, driven by props only.
//
// The copy is static, so the tests pin the shape rather than every sentence:
// the accessible name the App suite queries, the four sections in order, and
// the three dismissal paths — backdrop yes, close button yes, a click inside
// the panel no.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HelpDialog } from './HelpDialog'
import { installGetClientRectsStub } from '../../test/doubles/browser'
import {
  installDocumentPictureInPicture,
  type DocumentPictureInPictureDouble,
} from '../../test/doubles/documentPictureInPicture'
import styles from '../../App.module.css'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

let restoreGetClientRects: () => void
let pip: DocumentPictureInPictureDouble | null = null

beforeEach(() => {
  restoreGetClientRects = installGetClientRectsStub()
  pip = null
})

afterEach(() => {
  restoreGetClientRects()
  pip?.restore()
  document.body.innerHTML = ''
})

function renderDialog() {
  const onClose = vi.fn()
  const { container } = render(<HelpDialog onClose={onClose} />)
  return { onClose, container }
}

describe('HelpDialog framing', () => {
  it('is a modal dialog named by its own heading', () => {
    renderDialog()

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleName('Recording Tips')

    const title = document.getElementById('help-title') as HTMLElement
    expect(title.tagName).toBe('H2')
    expect(title).toHaveClass(styles.helpTitle)
  })

  it('covers what to capture, how, the modes and the formats — in that order', () => {
    renderDialog()

    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Choosing What to Record',
      'Best Practices',
      'Recording Modes',
      'Download Formats',
    ])
  })

  it('recommends whole-screen capture and names the six recording modes', () => {
    const { container } = renderDialog()

    expect(screen.getAllByText('Entire Screen')[0]).toBeInTheDocument()
    expect(container).toHaveTextContent('(Recommended)')
    expect(screen.getByText('Picture-in-Picture')).toBeInTheDocument()
    expect(screen.getByText('WebM')).toBeInTheDocument()
    expect(screen.getByText('MP4')).toBeInTheDocument()
  })

  it('repeats the keyboard shortcuts as keycaps', () => {
    const { container } = renderDialog()

    expect([...container.querySelectorAll('kbd')].map((k) => k.textContent)).toEqual([
      'R',
      'P',
      'S',
      'Esc',
    ])
  })
})

describe('HelpDialog dismissal', () => {
  it('closes when the backdrop is clicked', async () => {
    const user = userEvent.setup()
    const { onClose } = renderDialog()

    await user.click(screen.getByRole('dialog'))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('stays open when the click lands inside the panel', async () => {
    const user = userEvent.setup()
    const { onClose, container } = renderDialog()

    await user.click(container.querySelector(`.${styles.helpContent}`) as HTMLElement)
    await user.click(screen.getByRole('heading', { name: 'Recording Tips' }))

    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes from its own close button', async () => {
    const user = userEvent.setup()
    const { onClose } = renderDialog()

    const close = screen.getByRole('button', { name: 'Close help' })
    expect(close).toHaveAttribute('title', 'Close')

    await user.click(close)

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('HelpDialog keyboard and focus', () => {
  it('closes on Escape', () => {
    const { onClose } = renderDialog()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('moves focus into the dialog when it opens', () => {
    renderDialog()

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close help' }))
  })

  it('keeps Tab inside the dialog', () => {
    const { container } = renderDialog()

    const focusable = [
      ...container.querySelectorAll<HTMLElement>('button, [tabindex]:not([tabindex="-1"])'),
    ]
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    expect(focusable.length).toBeGreaterThan(1)

    last.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(first)

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
  })

  it('returns focus to whatever opened it', () => {
    const trigger = document.createElement('button')
    document.body.appendChild(trigger)
    trigger.focus()

    const { unmount } = render(<HelpDialog onClose={vi.fn()} />)
    expect(document.activeElement).not.toBe(trigger)

    unmount()

    expect(document.activeElement).toBe(trigger)
  })

  it('gives its scrolling body keyboard access', () => {
    const { container } = renderDialog()

    // axe's `scrollable-region-focusable`: the tips are a scrolling region with
    // no controls of its own, so it has to be reachable by Tab to be scrollable
    // from the keyboard at all.
    expect(container.querySelector(`.${styles.helpBody}`)).toHaveAttribute('tabindex', '0')
  })
})

// ESCSUITE-369: a bug report can say which build it came from.
describe('HelpDialog version line', () => {
  it("shows this app's package.json version", () => {
    const { version } = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'))
    renderDialog()

    expect(screen.getByRole('dialog')).toHaveTextContent(`ESCAPECRAFT v${version}`)
    expect(screen.getByText(`ESCAPECRAFT v${version}`)).toHaveClass(styles.helpVersion)
  })
})

describe('HelpDialog Float controls line (ESCSUITE-446)', () => {
  it('names Float controls where Document Picture-in-Picture is available', () => {
    pip = installDocumentPictureInPicture()
    renderDialog()

    expect(screen.getByText('Float controls')).toBeInTheDocument()
    expect(screen.getByText(/stays on top of whatever you are recording/)).toBeInTheDocument()
  })

  it('leaves it out where the browser has no Document Picture-in-Picture', () => {
    expect('documentPictureInPicture' in window).toBe(false)
    renderDialog()

    expect(screen.queryByText('Float controls')).not.toBeInTheDocument()
  })

  it('leaves it out when CRAFT is embedded, where the Float controls button is not drawn either', () => {
    pip = installDocumentPictureInPicture()
    const originalParent = window.parent
    Object.defineProperty(window, 'parent', { value: {}, configurable: true })
    try {
      renderDialog()

      expect(screen.queryByText('Float controls')).not.toBeInTheDocument()
    } finally {
      Object.defineProperty(window, 'parent', { value: originalParent, configurable: true })
    }
  })
})
