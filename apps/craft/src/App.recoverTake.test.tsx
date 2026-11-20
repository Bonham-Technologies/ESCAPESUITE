// ESCSUITE-466: the recovery prompt, end to end inside the app. The device's
// storage is the in-memory OPFS and Web Locks (`test/doubles/opfs.ts`), the
// library is real (fake-indexeddb), and the take store, the recovery scan and
// the trim are all real: only the codec-backed metadata repair and thumbnail
// decode are doubled, as every App suite doubles them.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRecorderStore } from './store/recorderStore';
import { getRecordingsMetadata } from './core/storage';
import { clearAllRecordings } from './test/recordingsDb';
import { converterModule, resetAppDoubles } from './test/appDoubles';
import { renderApp, resetRecorderStore, installBrowserStubs, flush, type BrowserStubs } from './test/appHarness';
import { installBrowserStorageDouble, type BrowserStorageDouble } from './test/doubles/opfs';
import { installVideoElementDouble, uninstallVideoElementDouble } from './test/doubles/video';
import { installGetClientRectsStub } from './test/doubles/browser';
import { el } from './test/webmFixture';
import { JOURNAL_FILE, TAKES_DIRECTORY, type TakeJournal } from './core/takeStore';
import { NOTHING_TO_RECOVER } from './utils/notices';

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

/** A small live-stream WebM with two whole blocks, the last at 1.5 s. */
function webm(): Uint8Array<ArrayBuffer> {
  const block = (rel: number) => el([0xa3], [0x81, (rel >> 8) & 0xff, rel & 0xff, 0x80, 0, 0, 0, 0]);
  return new Uint8Array([
    ...el([0x1a, 0x45, 0xdf, 0xa3], el([0x42, 0x82], [0x77, 0x65, 0x62, 0x6d])),
    0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    ...el([0x1f, 0x43, 0xb6, 0x75], [...el([0xe7], [0, 0]), ...block(0), ...block(1500)], true),
  ]);
}

const STARTED_AT = Date.UTC(2026, 10, 16, 9, 30);

let env: BrowserStorageDouble;
let browser: BrowserStubs;
let restoreGetClientRects: () => void;

async function leaveTake(takeId: string, startedAt: number, primary: Uint8Array<ArrayBuffer> = webm()): Promise<void> {
  const journal: TakeJournal = {
    version: 1,
    takeId,
    startedAt,
    recorder: 'mediarecorder',
    captured: {
      micAcquired: true,
      separateTracks: false,
      systemAudioEnabled: false,
      webcamEnabled: false,
      overlayPlacement: { position: 'bottom-right', size: 0.2, shape: 'circle' },
      hasVideoSource: true,
    },
    systemAudioShared: false,
  };
  const takes = await env.opfs.root.getDirectoryHandle(TAKES_DIRECTORY, { create: true });
  const dir = await takes.getDirectoryHandle(takeId, { create: true });
  (await dir.getFileHandle(JOURNAL_FILE, { create: true })).bytes = new TextEncoder().encode(JSON.stringify(journal));
  (await dir.getFileHandle('primary.webm', { create: true })).bytes = primary;
}

const prompt = () => screen.queryByRole('alertdialog', { name: 'Recover unfinished recording?' });
const user = () => userEvent.setup();

beforeEach(async () => {
  resetAppDoubles();
  resetRecorderStore({ countdownSeconds: 0 });
  browser = installBrowserStubs();
  installVideoElementDouble();
  env = installBrowserStorageDouble();
  // The dialog's focus trap only counts controls with a layout box.
  restoreGetClientRects = installGetClientRectsStub();
  converterModule.fixWebMMetadata.mockImplementation(async (blob: Blob) => blob);
  await clearAllRecordings();
});

afterEach(() => {
  restoreGetClientRects();
  env.restore();
  uninstallVideoElementDouble();
  browser.restore();
  vi.restoreAllMocks();
});

describe('App recovering an unfinished take', () => {
  it('offers a take left on the device as soon as it opens, with Recover focused', async () => {
    await leaveTake('t1', STARTED_AT);
    await renderApp();
    await waitFor(() => expect(prompt()).not.toBeNull());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Recover' })).toHaveFocus());
  });

  it('opens with no prompt when nothing was left', async () => {
    await renderApp();
    await flush();
    expect(prompt()).toBeNull();
  });

  it('Recover saves the take to the library, dated when it was recorded, and deletes the copy', async () => {
    await leaveTake('t1', STARTED_AT);
    await renderApp();
    await waitFor(() => expect(prompt()).not.toBeNull());

    await user().click(screen.getByRole('button', { name: 'Recover' }));

    await waitFor(() => expect(useRecorderStore.getState().recordings).toHaveLength(1));
    await waitFor(() => expect(env.opfs.root.dir(TAKES_DIRECTORY, 't1')).toBeUndefined());
    expect(prompt()).toBeNull();
    expect(useRecorderStore.getState().state).toBe('idle');
    const [meta] = await getRecordingsMetadata();
    expect(meta).toMatchObject({ recordedAt: STARTED_AT, source: 'recording', mimeType: 'video/webm' });
    expect(converterModule.fixWebMMetadata).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /^Play / })).toBeInTheDocument();
  });

  it('Discard deletes the copy and stores nothing', async () => {
    await leaveTake('t1', STARTED_AT);
    await renderApp();
    await waitFor(() => expect(prompt()).not.toBeNull());

    await user().click(screen.getByRole('button', { name: 'Discard' }));

    await waitFor(() => expect(env.opfs.root.dir(TAKES_DIRECTORY, 't1')).toBeUndefined());
    expect(prompt()).toBeNull();
    expect(await getRecordingsMetadata()).toEqual([]);
  });

  it('Escape leaves the copy for the next visit', async () => {
    await leaveTake('t1', STARTED_AT);
    await renderApp();
    await waitFor(() => expect(prompt()).not.toBeNull());

    await user().keyboard('{Escape}');

    expect(prompt()).toBeNull();
    expect(env.opfs.root.dir(TAKES_DIRECTORY, 't1')).toBeDefined();
  });

  it('says so, and deletes the copy, when the take held nothing playable', async () => {
    await leaveTake('t1', STARTED_AT, new Uint8Array([0x1a, 0x45, 0xdf]));
    await renderApp();
    await waitFor(() => expect(prompt()).not.toBeNull());

    await user().click(screen.getByRole('button', { name: 'Recover' }));

    await waitFor(() => expect(useRecorderStore.getState().notice).toBe(NOTHING_TO_RECOVER));
    expect(env.opfs.root.dir(TAKES_DIRECTORY, 't1')).toBeUndefined();
    expect(await getRecordingsMetadata()).toEqual([]);
  });

  it('waits behind the help and playback dialogs instead of stacking on them', async () => {
    await leaveTake('older', STARTED_AT);
    await leaveTake('newer', STARTED_AT + 60_000);
    await renderApp();
    await waitFor(() => expect(prompt()).not.toBeNull());
    // Recover the older one, so the library has something to play.
    await user().click(screen.getByRole('button', { name: 'Recover' }));
    await waitFor(() => expect(useRecorderStore.getState().recordings).toHaveLength(1));
    await waitFor(() => expect(prompt()).not.toBeNull());

    await user().click(screen.getByRole('button', { name: 'Help - Recording Tips' }));
    expect(prompt()).toBeNull();
    await user().keyboard('{Escape}');
    await waitFor(() => expect(prompt()).not.toBeNull());

    await user().click(screen.getByRole('button', { name: /^Play / }));
    await waitFor(() => expect(prompt()).toBeNull());
  });
});
