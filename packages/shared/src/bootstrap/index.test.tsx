import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from '@testing-library/react'

// Collaborators are mocked (never the module under test). react-dom/client
// keeps its real implementation so bootstrapApp's render actually lands in
// the DOM and can be asserted on; createRoot is wrapped in a spy so calls
// can be inspected too. @vercel/analytics/react is replaced with a marker
// component so its presence/absence can be asserted without a network call.
vi.mock('react-dom/client', async () => {
  const actual = await vi.importActual<typeof import('react-dom/client')>('react-dom/client')
  return {
    ...actual,
    createRoot: vi.fn(actual.createRoot),
  }
})

vi.mock('@vercel/analytics/react', () => ({
  Analytics: () => <div data-testid="vercel-analytics-marker" />,
}))

describe('bootstrapApp', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
    document.body.innerHTML = ''
  })

  afterEach(() => {
    document.body.innerHTML = ''
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  it('throws when the default #root element is missing', async () => {
    const { bootstrapApp } = await import('./index')
    const App = () => <div>App</div>

    expect(() => bootstrapApp({ App })).toThrow('Root element #root not found')
  })

  it('throws with the custom rootId named in the message', async () => {
    const { bootstrapApp } = await import('./index')
    const App = () => <div>App</div>

    expect(() => bootstrapApp({ rootId: 'app-root', App })).toThrow('Root element #app-root not found')
  })

  it('renders the App into the default #root element', async () => {
    const root = document.createElement('div')
    root.id = 'root'
    document.body.appendChild(root)

    const { bootstrapApp } = await import('./index')
    const { createRoot } = await import('react-dom/client')
    const App = () => <div data-testid="my-app">Hello</div>

    act(() => {
      bootstrapApp({ App })
    })

    expect(createRoot).toHaveBeenCalledWith(root)
    expect(root.querySelector('[data-testid="my-app"]')).not.toBeNull()
  })

  it('renders into a custom rootId element', async () => {
    const customRoot = document.createElement('div')
    customRoot.id = 'app-root'
    document.body.appendChild(customRoot)

    const { bootstrapApp } = await import('./index')
    const App = () => <div data-testid="my-app">Hello</div>

    act(() => {
      bootstrapApp({ rootId: 'app-root', App })
    })

    expect(customRoot.querySelector('[data-testid="my-app"]')).not.toBeNull()
  })

  it('mounts Analytics in SaaS mode (default build mode)', async () => {
    const root = document.createElement('div')
    root.id = 'root'
    document.body.appendChild(root)

    const { bootstrapApp } = await import('./index')
    const App = () => <div data-testid="my-app">Hello</div>

    act(() => {
      bootstrapApp({ App })
    })

    expect(root.querySelector('[data-testid="vercel-analytics-marker"]')).not.toBeNull()
  })

  it('does not mount Analytics in standalone build mode', async () => {
    vi.stubEnv('VITE_BUILD_MODE', 'standalone')
    vi.resetModules()

    const root = document.createElement('div')
    root.id = 'root'
    document.body.appendChild(root)

    const { bootstrapApp } = await import('./index')
    const App = () => <div data-testid="my-app">Hello</div>

    act(() => {
      bootstrapApp({ App })
    })

    expect(root.querySelector('[data-testid="my-app"]')).not.toBeNull()
    expect(root.querySelector('[data-testid="vercel-analytics-marker"]')).toBeNull()
  })
})
