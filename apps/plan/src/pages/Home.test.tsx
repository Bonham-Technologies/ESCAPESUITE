import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import Home from './Home'

// launchTool and trackOfflineDownload are collaborators (real navigation/analytics
// work) — mock them here, never the Home module under test.
vi.mock('../lib/launch', async () => {
  const actual = await vi.importActual<typeof import('../lib/launch')>('../lib/launch')
  return {
    ...actual,
    launchTool: vi.fn(),
    trackOfflineDownload: vi.fn(),
  }
})

import { launchTool, trackOfflineDownload } from '../lib/launch'

// Home renders no router-aware components (every link is a plain external <a>),
// so it needs no router wrapper.
function renderHome() {
  return render(<Home />)
}

describe('Home (open-source landing)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the hero with Use-now CTAs for both tools', () => {
    renderHome()
    expect(screen.getByRole('button', { name: /start recording/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /open the editor/i })).toBeInTheDocument()
  })

  it('links to GitHub and the "all downloads" releases page from the hero', () => {
    renderHome()
    const github = screen.getAllByRole('link', { name: /github/i })[0]
    expect(github).toHaveAttribute('href', 'https://github.com/Bonham-Technologies/ESCAPESUITE')
    // The hero's secondary link stays pointed at GitHub's bare "latest
    // release" listing — it is the "browse everything" escape hatch, not the
    // offline-build CTA, so a per-package release with no HTML attached is
    // an acceptable (if unhelpful) destination for it (ESCSUITE-195).
    const allDownloads = screen.getByRole('link', { name: /all downloads/i })
    expect(allDownloads).toHaveAttribute(
      'href',
      'https://github.com/Bonham-Technologies/ESCAPESUITE/releases/latest'
    )
  })

  it('has no pricing, sign-in, or trial content', () => {
    renderHome()
    expect(screen.queryByText(/pricing/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/sign in/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/free trial/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/\$\d/)).not.toBeInTheDocument()
  })

  it('describes the suite as free and open source', () => {
    renderHome()
    expect(screen.getAllByText(/open source/i).length).toBeGreaterThan(0)
  })

  it('exposes the open-source CTAs as links, not buttons nested in links', () => {
    const { container } = renderHome()

    // A <button> inside an <a> is invalid HTML and gives AT two roles for one
    // control — these CTAs navigate, so they must be plain anchors.
    expect(container.querySelector('a button')).toBeNull()

    // "View on GitHub" appears in both the hero and the open-source section.
    const repoLinks = screen.getAllByRole('link', { name: /view on github/i })
    expect(repoLinks).toHaveLength(2)
    for (const link of repoLinks) {
      expect(link).toHaveAttribute('href', 'https://github.com/Bonham-Technologies/ESCAPESUITE')
    }

    // The open-source section's download CTA is per-app (ESCSUITE-195): a
    // bare GitHub "latest release" link can resolve to a per-package release
    // with no offline build attached, so each button names its app and
    // points at that app's stable asset on the umbrella release instead.
    expect(screen.getByRole('link', { name: 'Download ESCAPECRAFT' })).toHaveAttribute(
      'href',
      'https://github.com/Bonham-Technologies/ESCAPESUITE/releases/latest/download/ESCAPECRAFT-latest.html'
    )
    expect(screen.getByRole('link', { name: 'Download ESCAPEARTIST' })).toHaveAttribute(
      'href',
      'https://github.com/Bonham-Technologies/ESCAPESUITE/releases/latest/download/ESCAPEARTIST-latest.html'
    )
  })

  it('launches ESCAPECRAFT from the hero "Start recording" CTA', async () => {
    const user = userEvent.setup()
    renderHome()
    await user.click(screen.getByRole('button', { name: /start recording/i }))
    expect(launchTool).toHaveBeenCalledWith('craft')
  })

  it('launches ESCAPEARTIST from the hero "Open the editor" CTA', async () => {
    const user = userEvent.setup()
    renderHome()
    await user.click(screen.getByRole('button', { name: /open the editor/i }))
    expect(launchTool).toHaveBeenCalledWith('artist')
  })

  it('launches ESCAPECRAFT from the tools-section "Use ESCAPECRAFT" CTA', async () => {
    const user = userEvent.setup()
    renderHome()
    await user.click(screen.getByRole('button', { name: /use escapecraft/i }))
    expect(launchTool).toHaveBeenCalledWith('craft')
  })

  it('launches ESCAPEARTIST from the tools-section "Use ESCAPEARTIST" CTA', async () => {
    const user = userEvent.setup()
    renderHome()
    await user.click(screen.getByRole('button', { name: /use escapeartist/i }))
    expect(launchTool).toHaveBeenCalledWith('artist')
  })

  it('tracks the offline build download with no tool from the hero "all downloads" link', async () => {
    const user = userEvent.setup()
    renderHome()
    // The anchor navigates to a new tab (target="_blank"), so following it in
    // jsdom raises "Not implemented: navigation" noise that is not the point
    // of this test — only that the tracker fires before that navigation.
    const navError = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await user.click(screen.getByRole('link', { name: /all downloads/i }))
    } finally {
      navError.mockRestore()
    }
    expect(trackOfflineDownload).toHaveBeenCalledTimes(1)
    expect(trackOfflineDownload).toHaveBeenCalledWith()
  })

  it('tracks the offline build download naming craft from the footer "Download ESCAPECRAFT" link', async () => {
    const user = userEvent.setup()
    renderHome()
    const navError = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await user.click(screen.getByRole('link', { name: 'Download ESCAPECRAFT' }))
    } finally {
      navError.mockRestore()
    }
    expect(trackOfflineDownload).toHaveBeenCalledTimes(1)
    expect(trackOfflineDownload).toHaveBeenCalledWith('craft')
  })

  it('tracks the offline build download naming artist from the footer "Download ESCAPEARTIST" link', async () => {
    const user = userEvent.setup()
    renderHome()
    const navError = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await user.click(screen.getByRole('link', { name: 'Download ESCAPEARTIST' }))
    } finally {
      navError.mockRestore()
    }
    expect(trackOfflineDownload).toHaveBeenCalledTimes(1)
    expect(trackOfflineDownload).toHaveBeenCalledWith('artist')
  })
})
