import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProjectLoadDialog } from './ProjectLoadDialog'

function handlers() {
  return {
    onCancel: vi.fn(),
    onSaveAndLoad: vi.fn(),
    onDiscardAndLoad: vi.fn(),
  }
}

describe('ProjectLoadDialog', () => {
  it('renders nothing while closed', () => {
    render(<ProjectLoadDialog isOpen={false} {...handlers()} />)

    expect(screen.queryByTestId('project-load-dialog')).not.toBeInTheDocument()
  })

  it('warns that loading replaces the current work', () => {
    render(<ProjectLoadDialog isOpen={true} {...handlers()} />)

    expect(screen.getByRole('heading', { name: 'Load Project' })).toBeInTheDocument()
    expect(
      screen.getByText('Loading a project will replace your current work.')
    ).toBeInTheDocument()
  })

  it('reports a cancel and nothing else', async () => {
    const user = userEvent.setup()
    const spies = handlers()
    render(<ProjectLoadDialog isOpen={true} {...spies} />)

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(spies.onCancel).toHaveBeenCalledTimes(1)
    expect(spies.onSaveAndLoad).not.toHaveBeenCalled()
    expect(spies.onDiscardAndLoad).not.toHaveBeenCalled()
  })

  it('reports save-and-load and nothing else', async () => {
    const user = userEvent.setup()
    const spies = handlers()
    render(<ProjectLoadDialog isOpen={true} {...spies} />)

    await user.click(screen.getByRole('button', { name: 'Save & Load' }))

    expect(spies.onSaveAndLoad).toHaveBeenCalledTimes(1)
    expect(spies.onCancel).not.toHaveBeenCalled()
    expect(spies.onDiscardAndLoad).not.toHaveBeenCalled()
  })

  it('reports discard-and-load and nothing else', async () => {
    const user = userEvent.setup()
    const spies = handlers()
    render(<ProjectLoadDialog isOpen={true} {...spies} />)

    await user.click(screen.getByRole('button', { name: 'Discard & Load' }))

    expect(spies.onDiscardAndLoad).toHaveBeenCalledTimes(1)
    expect(spies.onCancel).not.toHaveBeenCalled()
    expect(spies.onSaveAndLoad).not.toHaveBeenCalled()
  })
})
