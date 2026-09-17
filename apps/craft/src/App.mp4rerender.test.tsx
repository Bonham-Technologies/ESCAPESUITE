// What one MP4 conversion progress tick costs the React tree.
//
// `convertToMP4` reports progress continuously for the whole length of a
// conversion, and the only pixels it moves are the progress bar and its label
// inside one library row. So a progress report costs the library a render and
// costs `App` — and with it the header, the preview stage, the transport bar
// and the seven hooks `App` calls — nothing at all.
//
// This is the same conservation law `App.rerender.test.tsx` states for audio
// levels, and it holds for the same reason: the conversion state lives in
// `RecordingsListPanel`, below `App`, exactly as `audioLevels` lives in
// `SourceTogglesPanel`. That file is deliberately left alone — it counts the
// level push and nothing else — so the MP4 half is counted here.
//
// Counting method is `App.rerender.test.tsx`'s: a pass-through `vi.spyOn` on
// each module namespace, installed before the tree is created, with `App`
// counted through `useKeyboardShortcuts` (called exactly once per `App` render
// and by nothing else in the tree).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { storeVideo } from './core/storage';
import { clearAllRecordings } from './test/recordingsDb';
import type { SourceVideo } from './store/types';
import {
  converterModule,
  resetAppDoubles,
  type ConversionProgressLike,
} from './test/appDoubles';
import {
  renderApp,
  resetRecorderStore,
  installBrowserStubs,
  flush,
  type BrowserStubs,
} from './test/appHarness';
import * as keyboardShortcuts from './hooks/useKeyboardShortcuts';
import * as recordingsList from './components/RecordingsList/RecordingsList';

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

beforeEach(async () => {
  resetAppDoubles();
  resetRecorderStore();
  browser = installBrowserStubs();
  await clearAllRecordings();
});

afterEach(() => {
  browser.restore();
  vi.restoreAllMocks();
});

function metadata(id: string, name: string): SourceVideo {
  return {
    id,
    name,
    duration: 30,
    width: 1920,
    height: 1080,
    frameRate: 30,
    mimeType: 'video/webm',
    size: 1024,
    mediaType: 'video',
    source: 'recording',
    recordedAt: 1_000,
  };
}

/** Ten progress reports, roughly what a short conversion emits. */
const PROGRESS_TICKS = 10;

describe('an MP4 progress report and the React tree', () => {
  it('re-renders only the library that draws the progress bar', async () => {
    await storeVideo('take-1', new Blob(['bytes'], { type: 'video/webm' }), metadata('take-1', 'Take One'));

    let report: (progress: ConversionProgressLike) => void = () => {};
    let finish: (blob: Blob) => void = () => {};
    const started = new Promise<void>((resolveStarted) => {
      converterModule.convertToMP4.mockImplementation(
        (_blob, onProgress) =>
          new Promise<Blob>((resolve) => {
            report = onProgress;
            finish = resolve;
            resolveStarted();
          })
      );
    });

    const appRenders = vi.spyOn(keyboardShortcuts, 'useKeyboardShortcuts');
    const listRenders = vi.spyOn(recordingsList, 'RecordingsList');
    await renderApp();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Download Take One as MP4' }));
    await act(async () => {
      await started;
    });

    const appBefore = appRenders.mock.calls.length;
    const listBefore = listRenders.mock.calls.length;

    // One act per report: a loop inside a single act would batch the whole
    // conversion into one commit, and the count below would be 1 either way.
    for (let i = 1; i <= PROGRESS_TICKS; i++) {
      act(() => {
        report({ phase: 'encoding', progress: i * 10, message: 'Encoding video...' });
      });
    }

    expect(appRenders.mock.calls.length - appBefore).toBe(0);
    expect(listRenders.mock.calls.length - listBefore).toBe(PROGRESS_TICKS);
    expect(screen.getByRole('progressbar', { name: 'Converting Take One to MP4' })).toHaveAttribute(
      'aria-valuenow',
      '100'
    );

    await act(async () => {
      finish(new Blob(['mp4'], { type: 'video/mp4' }));
    });
    await flush();
  });
});
