// Render App and settle its mount-time async work.
//
// App looks for a saved session on mount and installs the integration handler
// in the same pass; without letting those promises resolve, every later
// interaction reports an act() warning. Shared by the App.*.test.tsx files.
import { act, render } from '@testing-library/react'
import App from '../App'

export async function renderApp() {
  const view = render(<App />)
  await settleApp()
  return view
}

/**
 * Let the app's chained async work resolve inside act().
 *
 * Two microtask turns is enough for everything the doubles do: the session
 * lookup resolves immediately and the URL-parameter work is chained off the
 * same tick, as is the preview's media load after a clip appears. Anything
 * that resolves later would update React after the test had finished — which
 * React reports, and which leaves the update unasserted.
 */
export async function settleApp(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}
