// What one audio-level push costs the React tree.
//
// Both recorders read their analysers on `requestAnimationFrame` and push an
// `AudioLevels` into the store ~12 times a second for the whole length of a
// take (see "Audio level meters" in `apps/craft/CLAUDE.md`). The only pixels
// that value moves are the two meter bars inside the Sources panel, so a level
// push costs the Sources panel a render and costs the rest of the screen — the
// header, the library, the preview stage, the transport bar, and `App` itself
// with the seven hooks it calls — nothing at all.
//
// That is the contract, and it is a conservation law rather than a ceiling: a
// component that does not subscribe to `audioLevels` re-renders exactly never,
// so the numbers below are exact. It holds because `App` selects each field it
// reads (`App.tsx`) and `SourceTogglesPanel` owns the subscription to the three
// fields only the Sources panel draws. Before that — measured 2026-09-16 with
// this same file — `App`'s whole-store `useRecorderStore()` made it 12 renders
// each, for all six.
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
// they are no longer handed by `App` — a render counter alone would pass on a
// panel that subscribed to nothing — so the meter width is asserted from the
// DOM in the same file.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { act } from '@testing-library/react';
import { useRecorderStore } from './store/recorderStore';
import type { RecordingState } from './store/types';
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
import * as durationReadout from './components/RecorderControls/RecordingDurationReadout';
import * as countdownOverlay from './components/RecordingPreview/CountdownOverlay';

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
 *
 * `state` is a parameter only so the countdown suite below can mount mid-count
 * with its overlay actually on screen; every level-push test takes the default.
 */
async function renderCountingApp(
  state: RecordingState = 'recording'
): Promise<{ counters: Counters; mounted: Record<keyof Counters, number> }> {
  const counters: Counters = {
    app: vi.spyOn(keyboardShortcuts, 'useKeyboardShortcuts'),
    sourceToggles: vi.spyOn(sourceToggles, 'SourceToggles'),
    recordingsList: vi.spyOn(recordingsList, 'RecordingsList'),
    recorderControls: vi.spyOn(recorderControls, 'RecorderControls'),
    recordingPreview: vi.spyOn(recordingPreview, 'RecordingPreview'),
    appHeader: vi.spyOn(appHeader, 'AppHeader'),
  };
  useRecorderStore.setState({ state });
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
  it('re-renders only the Sources panel that draws the meters', async () => {
    const { counters, mounted } = await renderCountingApp();

    pushLevels(LEVEL_PUSHES);

    // Measured 2026-09-16, before and after: App 12 → 0, AppHeader 12 → 0,
    // RecordingsList 12 → 0, RecorderControls 12 → 0, RecordingPreview 12 → 0,
    // SourceToggles 12 → 12. Exact rather than a 2x ceiling, because "does not
    // subscribe" has no spread: a re-introduced `useRecorderStore()` in `App`,
    // or an `audioLevels` prop threaded back down through it, puts all five
    // back to LEVEL_PUSHES and fails here.
    expect(since(counters, mounted)).toEqual({
      app: 0,
      appHeader: 0,
      recordingsList: 0,
      recorderControls: 0,
      recordingPreview: 0,
      sourceToggles: LEVEL_PUSHES,
    });
  });

  it('draws the level App never handed it', async () => {
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

/**
 * The two numbers that tick on their own: the elapsed-duration readout, once a
 * second for the whole length of a take, and the 3-2-1 countdown before one.
 */
const DURATION_TICKS = 5;
const COUNTDOWN_TICKS = 3;

/**
 * Tick the elapsed duration `count` times, one `act` each.
 *
 * One `act` per tick for the same reason `pushLevels` takes one: the controller
 * writes one value per interval, and a loop inside a single `act` would batch
 * them all into one commit.
 *
 * Each tick writes a DISTINCT value (`i`, then a descending countdown), and the
 * exact leaf counts below depend on it: zustand drops a write whose value is
 * `Object.is`-equal to the current one, so a loop that pushed a constant would
 * make the leaf render once and the pin read as a regression. `pushLevels`
 * does not share the hazard — it writes a fresh object each push.
 */
function tickDuration(count: number): void {
  for (let i = 1; i <= count; i++) {
    act(() => {
      useRecorderStore.getState().setCurrentDuration(i);
    });
  }
}

/** Count down from `count` to 1, one `act` each, as the countdown interval does. */
function tickCountdown(count: number): void {
  for (let i = count; i >= 1; i--) {
    act(() => {
      useRecorderStore.getState().setCountdown(i);
    });
  }
}

interface LeafCounters {
  durationReadout: ReturnType<typeof vi.spyOn>;
  countdownOverlay: ReturnType<typeof vi.spyOn>;
}

/**
 * The same counting method one level lower, for the two leaves that *do*
 * subscribe to the ticking fields. Installed before the tree is created, like
 * the six above, and counted separately so the six existing expectations in
 * this file keep their exact shape.
 */
function leafRenders(leaves: LeafCounters): Record<keyof LeafCounters, number> {
  return {
    durationReadout: leaves.durationReadout.mock.calls.length,
    countdownOverlay: leaves.countdownOverlay.mock.calls.length,
  };
}

describe('the duration tick and the countdown, and the React tree', () => {
  it('re-renders the two leaves that draw the numbers, and nothing above them', async () => {
    const leaves: LeafCounters = {
      durationReadout: vi.spyOn(durationReadout, 'RecordingDurationReadout'),
      countdownOverlay: vi.spyOn(countdownOverlay, 'CountdownOverlay'),
    };
    // Mounted mid-countdown, so both leaves are on screen for real: the
    // readout draws its zero and the overlay is one tick from a number.
    const { counters, mounted } = await renderCountingApp('countdown');
    const leavesMounted = leafRenders(leaves);

    tickDuration(DURATION_TICKS);
    tickCountdown(COUNTDOWN_TICKS);

    // Measured 2026-09-23, before and after: `App` 8 → 0, and with it
    // `AppHeader` 8 → 0, `RecordingsList` 8 → 0, `RecorderControls` 8 → 0,
    // `RecordingPreview` 8 → 0, `SourceToggles` 8 → 0 — eight being the five
    // duration ticks plus the three countdown ticks, every one of which used
    // to re-render the whole screen and the seven hooks `App` calls. Exact,
    // for the same reason the level-push counts are: a component that does not
    // subscribe re-renders never, so putting either selector back in `App`
    // fails here and nowhere else.
    expect(since(counters, mounted)).toEqual({
      app: 0,
      appHeader: 0,
      recordingsList: 0,
      recorderControls: 0,
      recordingPreview: 0,
      sourceToggles: 0,
    });
    // And the work has to land *somewhere* — a leaf that subscribed to nothing
    // would pass the block above by rendering zero times.
    expect(leafRenders(leaves)).toEqual({
      durationReadout: leavesMounted.durationReadout + DURATION_TICKS,
      countdownOverlay: leavesMounted.countdownOverlay + COUNTDOWN_TICKS,
    });
  });

  it('draws the numbers App never handed them', async () => {
    useRecorderStore.setState({ state: 'countdown' });
    const { container } = await renderApp();

    act(() => {
      useRecorderStore.getState().setCurrentDuration(65);
    });
    act(() => {
      useRecorderStore.getState().setCountdown(2);
    });

    expect(container.querySelector(`.${styles.timer}`)).toHaveTextContent('01:05');
    expect(container.querySelector(`.${styles.countdownNumber}`)).toHaveTextContent('2');
  });
});
