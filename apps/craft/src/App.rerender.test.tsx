// What one audio-level push costs the React tree.
//
// Both recorders read their analysers on `requestAnimationFrame` and push an
// `AudioLevels` into the store ~12 times a second for the whole length of a
// take (see "Audio level meters" in `apps/craft/CLAUDE.md`). The only pixels
// that value moves are the two meter bars inside the Sources panel, so a level
// push should cost the Sources panel a render and cost the rest of the screen —
// the header, the library, the preview stage, the transport bar, and `App`
// itself with the seven hooks it calls — nothing at all.
//
// **This file currently pins the finding, not the target.** `App` subscribes to
// the store with no selector, so every `setAudioLevels` re-renders `App` and
// with it every component below: measured 2026-09-16, 12 renders each for 12
// pushes. The assertion in the first test is written as the numbers that are
// true today, and is the one to flip — to 0 everywhere but the Sources panel —
// when `App` moves to per-field selectors.
//
// How the counts are taken: a pass-through `vi.spyOn` on each module namespace
// (no `mockImplementation` — the real component still runs), installed *before*
// the tree is created so the element type identity stays stable across renders
// and every render calls the spy exactly once. `App` is counted through
// `useKeyboardShortcuts`, which `App` calls exactly once per render and nothing
// else in the tree calls at all. A React `Profiler` cannot do either job:
// `onRender` fires once per commit for a whole subtree, and the question here
// is which individual components re-ran.
//
// The other half of the contract is that the meters must still draw the level
// the recorder pushed, whichever route it travels, so the meter width is
// asserted from the DOM in the same file.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { act } from '@testing-library/react';
import { useRecorderStore } from './store/recorderStore';
import { resetAppDoubles } from './test/appDoubles';
import {
  renderApp,
  resetRecorderStore,
  installBrowserStubs,
  flush,
  type BrowserStubs,
} from './test/appHarness';
import styles from './App.module.css';
import * as keyboardShortcuts from './hooks/useKeyboardShortcuts';
import * as sourceToggles from './components/SourceToggles/SourceToggles';
import * as recordingsList from './components/RecordingsList/RecordingsList';
import * as recorderControls from './components/RecorderControls/RecorderControls';
import * as recordingPreview from './components/RecordingPreview/RecordingPreview';
import * as appHeader from './components/AppHeader/AppHeader';

// The same browser boundaries every other App suite replaces: capture, WebCodecs
// muxing, thumbnail decoding, editor navigation, analytics delivery.
vi.mock('./core/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./core/permissions')>();
  const { permissionsOverrides: overrides } = await import('./test/appDoubles');
  return { ...actual, ...overrides };
});
vi.mock('./core/recorder-factory', async () => (await import('./test/appDoubles')).recorderFactoryModule);
vi.mock('./core/thumbnailGenerator', async () => (await import('./test/appDoubles')).thumbnailModule);
vi.mock('./core/converter', async () => (await import('./test/appDoubles')).converterModule);
vi.mock('./utils/sendToEditor', async () => (await import('./test/appDoubles')).sendToEditorModule);
vi.mock('@vercel/analytics', async () => (await import('./test/appDoubles')).analyticsModule);

let browser: BrowserStubs;

beforeEach(() => {
  resetAppDoubles();
  resetRecorderStore({ microphoneEnabled: true, systemAudioEnabled: true });
  browser = installBrowserStubs();
});

afterEach(() => {
  browser.restore();
  vi.restoreAllMocks();
});

/** One take's worth of level pushes at the recorders' own ~12 Hz gate. */
const LEVEL_PUSHES = 12;

interface Counters {
  app: ReturnType<typeof vi.spyOn>;
  sourceToggles: ReturnType<typeof vi.spyOn>;
  recordingsList: ReturnType<typeof vi.spyOn>;
  recorderControls: ReturnType<typeof vi.spyOn>;
  recordingPreview: ReturnType<typeof vi.spyOn>;
  appHeader: ReturnType<typeof vi.spyOn>;
}

/**
 * Install the render counters, then mount the app mid-take with both audio
 * sources on, so the meters are on screen and a level push has somewhere to go.
 */
async function renderCountingApp(): Promise<{ counters: Counters; mounted: Record<keyof Counters, number> }> {
  const counters: Counters = {
    app: vi.spyOn(keyboardShortcuts, 'useKeyboardShortcuts'),
    sourceToggles: vi.spyOn(sourceToggles, 'SourceToggles'),
    recordingsList: vi.spyOn(recordingsList, 'RecordingsList'),
    recorderControls: vi.spyOn(recorderControls, 'RecorderControls'),
    recordingPreview: vi.spyOn(recordingPreview, 'RecordingPreview'),
    appHeader: vi.spyOn(appHeader, 'AppHeader'),
  };
  useRecorderStore.setState({ state: 'recording' });
  await renderApp();
  return { counters, mounted: renders(counters) };
}

function renders(counters: Counters): Record<keyof Counters, number> {
  return {
    app: counters.app.mock.calls.length,
    sourceToggles: counters.sourceToggles.mock.calls.length,
    recordingsList: counters.recordingsList.mock.calls.length,
    recorderControls: counters.recorderControls.mock.calls.length,
    recordingPreview: counters.recordingPreview.mock.calls.length,
    appHeader: counters.appHeader.mock.calls.length,
  };
}

function since(counters: Counters, mounted: Record<keyof Counters, number>): Record<keyof Counters, number> {
  const now = renders(counters);
  return {
    app: now.app - mounted.app,
    sourceToggles: now.sourceToggles - mounted.sourceToggles,
    recordingsList: now.recordingsList - mounted.recordingsList,
    recorderControls: now.recorderControls - mounted.recorderControls,
    recordingPreview: now.recordingPreview - mounted.recordingPreview,
    appHeader: now.appHeader - mounted.appHeader,
  };
}

/**
 * Push `count` levels, one `act` each.
 *
 * One `act` per push rather than one around the loop: the recorder writes one
 * level per gate window, and a loop inside a single `act` would batch the whole
 * take into one commit — every count below would then be 1 whether the tree
 * subscribes to `audioLevels` or not.
 */
function pushLevels(count: number): void {
  for (let i = 1; i <= count; i++) {
    act(() => {
      useRecorderStore.getState().setAudioLevels({ microphone: i / count, system: 1 - i / count });
    });
  }
}

describe('an audio-level push and the React tree', () => {
  it('re-renders the whole tree, not only the Sources panel that draws the meters', async () => {
    const { counters, mounted } = await renderCountingApp();

    pushLevels(LEVEL_PUSHES);

    // The finding, measured 2026-09-16: one commit per push, and `App`'s
    // no-selector store subscription drags every component below it along for
    // a value only the two meter bars read. Flip the five zeros in when `App`
    // selects what it reads; `sourceToggles` stays at LEVEL_PUSHES either way,
    // because the panel is the one part of the screen that must redraw.
    expect(since(counters, mounted)).toEqual({
      app: LEVEL_PUSHES,
      appHeader: LEVEL_PUSHES,
      recordingsList: LEVEL_PUSHES,
      recorderControls: LEVEL_PUSHES,
      recordingPreview: LEVEL_PUSHES,
      sourceToggles: LEVEL_PUSHES,
    });
  });

  it('draws the level the recorder pushed into the store', async () => {
    const { container } = await renderApp();
    act(() => {
      useRecorderStore.setState({ state: 'recording' });
    });

    act(() => {
      useRecorderStore.getState().setAudioLevels({ microphone: 0.42, system: 0.25 });
    });

    const fills = [...container.querySelectorAll<HTMLElement>(`.${styles.meterFill}`)];
    expect(fills).toHaveLength(2);
    expect(fills[0]).toHaveStyle({ width: '42%' });
    expect(fills[1]).toHaveStyle({ width: '25%' });
  });
});

describe('a state change and the React tree', () => {
  it('re-renders App exactly once when the recorder state changes', async () => {
    const { counters, mounted } = await renderCountingApp();

    act(() => {
      useRecorderStore.getState().setState('paused');
    });

    expect(since(counters, mounted).app).toBe(1);
  });

  it('still re-renders App when a config change reaches it', async () => {
    const { counters, mounted } = await renderCountingApp();

    act(() => {
      useRecorderStore.getState().setConfig({ webcamEnabled: true });
    });

    expect(since(counters, mounted).app).toBe(1);
  });

  it('still re-renders App when the library gains a recording', async () => {
    const { counters, mounted } = await renderCountingApp();

    act(() => {
      useRecorderStore.getState().addRecording({
        id: 'r1',
        name: 'Take 1',
        duration: 1,
        createdAt: 0,
        size: 10,
        hasWebcam: false,
        hasAudio: true,
      });
    });
    await flush();

    expect(since(counters, mounted).app).toBeGreaterThanOrEqual(1);
  });
});
