import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { act, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRecorderStore } from './store/recorderStore';
import {
  clearAllRecordings,
  storeVideo,
  storeThumbnail,
  deleteVideo,
  getRecordingsMetadata,
} from './core/storage';
import type { SourceVideo } from './store/types';
import {
  sendToEditorModule,
  analyticsModule,
  resetAppDoubles,
} from './test/appDoubles';
import {
  renderApp,
  resetRecorderStore,
  installBrowserStubs,
  type BrowserStubs,
} from './test/appHarness';
import { installVideoElementDouble, uninstallVideoElementDouble } from './test/doubles/video';

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
  installVideoElementDouble();
  vi.mocked(URL.revokeObjectURL).mockClear();
  await clearAllRecordings();
});

afterEach(() => {
  uninstallVideoElementDouble();
  browser.restore();
  vi.restoreAllMocks();
});

const user = () => userEvent.setup();

function metadata(overrides: Partial<SourceVideo> & { id: string; name: string }): SourceVideo {
  return {
    duration: 30,
    width: 1920,
    height: 1080,
    frameRate: 30,
    mimeType: 'video/webm',
    size: 5 * 1024 * 1024,
    mediaType: 'video',
    source: 'recording',
    recordedAt: 1_000,
    ...overrides,
  };
}

async function seedRecording(
  overrides: Partial<SourceVideo> & { id: string; name: string },
  options: { withThumbnail?: boolean } = {}
): Promise<void> {
  await storeVideo(
    overrides.id,
    new Blob(['video-bytes'], { type: 'video/webm' }),
    metadata(overrides)
  );
  if (options.withThumbnail !== false) {
    await storeThumbnail(overrides.id, new Blob(['thumb'], { type: 'image/jpeg' }));
  }
}

function items(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[class*="recordingItem"]'));
}

describe('App recordings list', () => {
  it('loads what is in storage, newest first, with duration and size', async () => {
    await seedRecording({ id: 'older', name: 'Older Take', recordedAt: 1_000, duration: 65, size: 2 * 1024 * 1024 });
    await seedRecording({ id: 'newer', name: 'Newer Take', recordedAt: 2_000, duration: 9, size: 10 * 1024 * 1024 });

    await renderApp();

    const listed = items();
    expect(listed).toHaveLength(2);
    expect(listed[0].textContent).toContain('Newer Take');
    expect(listed[0].textContent).toContain('00:09');
    expect(listed[0].textContent).toContain('10.0 MB');
    expect(listed[1].textContent).toContain('Older Take');
    expect(listed[1].textContent).toContain('01:05');
    expect(listed[1].textContent).toContain('2.0 MB');
  });

  it('shows the stored thumbnail, and a blank tile when there is none', async () => {
    await seedRecording({ id: 'with-thumb', name: 'With Thumb', recordedAt: 2_000 });
    await seedRecording({ id: 'no-thumb', name: 'No Thumb', recordedAt: 1_000 }, { withThumbnail: false });

    await renderApp();

    const [first, second] = items();
    expect(first.querySelector('img')).toHaveAttribute('src', 'blob:mock-url');
    expect(second.querySelector('img')).toBeNull();
    expect(second.querySelector('[class*="recordingThumbnail"]')).toBeTruthy();
  });
});

describe('App recording playback', () => {
  it('opens the player for the chosen recording and closes it again', async () => {
    await seedRecording({ id: 'take-1', name: 'Standup Demo', duration: 42 });
    await renderApp();

    await user().click(screen.getByRole('button', { name: 'Play Standup Demo' }));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAccessibleName('Standup Demo');
    const video = dialog.querySelector('video') as HTMLVideoElement;
    expect(video).toHaveAttribute('src', 'blob:mock-url');

    // knownDuration comes from the list entry, not the WebM header.
    act(() => {
      Object.defineProperty(video, 'duration', { configurable: true, get: () => Infinity });
      fireEvent.loadedMetadata(video);
    });
    expect(dialog.querySelector('[class*="timeDisplay"]')!.textContent).toBe('0:00 / 0:42');

    await user().click(screen.getByRole('button', { name: 'Close playback' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });

  it('closes the player from the backdrop but not from the panel', async () => {
    await seedRecording({ id: 'take-1', name: 'Standup Demo' });
    await renderApp();
    await user().click(screen.getByRole('button', { name: 'Play Standup Demo' }));

    await user().click(screen.getByText('Standup Demo', { selector: '[class*="playbackTitle"]' }));
    expect(screen.getByRole('dialog')).toBeTruthy();

    await user().click(screen.getByRole('dialog'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('revokes the previous object URL when a second recording is played', async () => {
    await seedRecording({ id: 'a', name: 'First', recordedAt: 2_000 });
    await seedRecording({ id: 'b', name: 'Second', recordedAt: 1_000 });
    await renderApp();

    await user().click(screen.getByRole('button', { name: 'Play First' }));
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    await user().click(screen.getByRole('button', { name: 'Play Second' }));
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Second');
  });

  it('does nothing when the stored blob has gone missing', async () => {
    await seedRecording({ id: 'ghost', name: 'Ghost Take' });
    await renderApp();
    await deleteVideo('ghost'); // storage pruned behind the app's back

    await user().click(screen.getByRole('button', { name: 'Play Ghost Take' }));

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('logs a playback failure reported by the player', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    await seedRecording({ id: 'take-1', name: 'Standup Demo' });
    await renderApp();
    await user().click(screen.getByRole('button', { name: 'Play Standup Demo' }));

    const video = screen.getByRole('dialog').querySelector('video') as HTMLVideoElement;
    act(() => {
      fireEvent.error(video);
    });

    expect(consoleError).toHaveBeenCalledWith('Video playback error:', expect.any(Error));
  });
});

describe('App recording downloads', () => {
  it('downloads the stored WebM under a filesystem-safe name', async () => {
    await seedRecording({ id: 'take-1', name: 'Standup Demo: 9/9' });
    await renderApp();

    await user().click(screen.getByRole('button', { name: 'Download Standup Demo: 9/9' }));

    expect(browser.downloads).toEqual([{ href: 'blob:mock-url', download: 'standup_demo__9_9.webm' }]);
    expect(analyticsModule.track).toHaveBeenCalledWith('Recording Downloaded', undefined);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    expect(document.querySelector('a[download]')).toBeNull();
  });

  it('does nothing when the stored blob has gone missing', async () => {
    await seedRecording({ id: 'ghost', name: 'Ghost Take' });
    await renderApp();
    await deleteVideo('ghost');

    await user().click(screen.getByRole('button', { name: 'Download Ghost Take' }));

    expect(browser.downloads).toEqual([]);
    expect(analyticsModule.track).not.toHaveBeenCalledWith('Recording Downloaded', undefined);
  });
});

describe('App recording hand-off and deletion', () => {
  it('hands the chosen recording to the editor', async () => {
    await seedRecording({ id: 'take-1', name: 'Standup Demo' });
    await renderApp();

    await user().click(screen.getByRole('button', { name: 'Open Standup Demo in Editor' }));

    expect(sendToEditorModule.sendToEditor).toHaveBeenCalledWith('take-1');
    expect(browser.open).not.toHaveBeenCalled();
  });

  it('deletes the recording from storage and from the list', async () => {
    await seedRecording({ id: 'keep', name: 'Keep Me', recordedAt: 2_000 });
    await seedRecording({ id: 'drop', name: 'Drop Me', recordedAt: 1_000 });
    await renderApp();

    await act(async () => {
      await user().click(screen.getByRole('button', { name: 'Delete Drop Me' }));
    });

    expect(useRecorderStore.getState().recordings.map(r => r.id)).toEqual(['keep']);
    expect(items()).toHaveLength(1);
    expect((await getRecordingsMetadata()).map(m => m.id)).toEqual(['keep']);
  });

  it('shows the empty state again once the last recording is deleted', async () => {
    await seedRecording({ id: 'only', name: 'Only Take' });
    await renderApp();

    await act(async () => {
      await user().click(screen.getByRole('button', { name: 'Delete Only Take' }));
    });

    expect(screen.getByText('No recordings yet')).toBeTruthy();
  });
});
