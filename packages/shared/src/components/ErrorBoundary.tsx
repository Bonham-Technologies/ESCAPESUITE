// The one React error boundary for ESCAPECRAFT and ESCAPEARTIST (ESCSUITE-212).
//
// Neither app had one before this: a render-time throw anywhere in the tree
// unmounted the whole app to a blank page, with nothing on screen to say why
// — and in ESCAPECRAFT, whatever recorder was live kept capturing into a UI
// nobody could see or stop, because nothing told it the take was over.
//
// `bootstrapApp` (`../bootstrap`) mounts this once, around the app root, for
// both apps. Its fallback carries no app-specific copy on purpose: this
// package has no idea which app is using it, so the panel says only what is
// true of either — something broke, and reloading is the way back — and
// leaves anything more specific (what was lost, what to do instead) to each
// app's own `onError`, which runs first and is the hook a host app uses to
// let a half-finished piece of state go cleanly instead of leaving it
// dangling. ESCAPECRAFT's disposes a live recorder; ESCAPEARTIST's is a
// deliberate no-op — see `apps/craft/src/main.tsx` and
// `apps/artist/src/main.tsx`.
//
// Like every React error boundary, this only catches a **render-time**
// throw — in `render()`, a constructor, or a lifecycle method, on some
// component below it. A throw from an event handler, a `setTimeout`/
// `requestAnimationFrame` callback, an async function, a rejected promise,
// or the fallback it renders itself, reaches none of this.
import { Component, type ErrorInfo, type ReactNode } from 'react';

export interface ErrorBoundaryProps {
  children: ReactNode;
  /**
   * Called once per caught error, before the fallback is shown. The one
   * place a host app reaches for anything it needs to let go of — a live
   * recorder's tracks, an open stream — that nothing else will release once
   * this boundary swaps the broken tree for its fallback.
   */
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * Catches a render-time throw anywhere below it and shows one minimal,
 * accessible panel instead of leaving the page blank.
 *
 * Once `hasError` is true it stays true: `render()` has no recovery path (no
 * "try again" that re-renders the children that just threw), so a parent
 * that keeps re-rendering new children into a boundary that has already
 * caught one error never gets a second chance to throw through it — the
 * fallback is all this boundary ever shows again until the whole page
 * reloads, which is what its one button is for.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // `import.meta.env.DEV` is inlined to a literal boolean by Vite the same
    // way `BUILD_MODE` is (see `../config`), so a production build folds this
    // branch away and drops the dead `console.error` call rather than
    // shipping it inert.
    if (import.meta.env.DEV) {
      console.error('[ErrorBoundary] caught a render error:', error, info);
    }
    this.props.onError?.(error, info);
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div
        role="alert"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '1rem',
          height: '100vh',
          padding: '2rem',
          textAlign: 'center',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <h1 style={{ margin: 0, fontSize: '1.25rem' }}>Something went wrong</h1>
        <p style={{ margin: 0 }}>An unexpected error occurred. Reloading the page should fix it.</p>
        <button type="button" onClick={this.handleReload}>
          Reload
        </button>
      </div>
    );
  }
}
