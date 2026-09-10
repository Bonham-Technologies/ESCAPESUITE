// Render App and settle its mount-time async work.
//
// App looks for a saved session on mount and installs the integration handler
// in the same pass; without letting those promises resolve, every later
// interaction reports an act() warning. Shared by the App.*.test.tsx files.
import { act, render } from '@testing-library/react'
import App from '../App'

export async function renderApp() {
  const view = render(<App />)
  // One microtask turn is enough: the session lookup resolves immediately in
  // the doubles, and the URL-parameter work is chained off the same tick.
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
  return view
}
