import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { act, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRecorderStore } from './store/recorderStore';
import {
  storeVideo,
  storeThumbnail,
  deleteVideo,
  getRecordingsMetadata,
} from './core/storage';
import { clearAllRecordings } from './test/recordingsDb';
import type { SourceVideo } from './store/types';
import {
  sendToEditorModule,
  analyticsModule,
  converterModule,
  resetAppDoubles,
} from './test/appDoubles';
import {
  renderApp,
  resetRecorderStore,
  installBrowserStubs,
  flush,
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

    const dialog = await screen.findByRole('dialog');
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
    expect(await screen.findByRole('dialog')).toBeTruthy();

    await user().click(await screen.findByRole('dialog'));
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
    expect(await screen.findByRole('dialog')).toHaveAccessibleName('Second');
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

    const video = (await screen.findByRole('dialog')).querySelector('video') as HTMLVideoElement;
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

    await user().click(screen.getByRole('button', { name: 'Delete Drop Me' }));
    await flush();

    expect(useRecorderStore.getState().recordings.map(r => r.id)).toEqual(['keep']);
    expect(items()).toHaveLength(1);
    expect((await getRecordingsMetadata()).map(m => m.id)).toEqual(['keep']);
  });

  it('shows the empty state again once the last recording is deleted', async () => {
    await seedRecording({ id: 'only', name: 'Only Take' });
    await renderApp();

    await user().click(screen.getByRole('button', { name: 'Delete Only Take' }));
    await flush();

    expect(screen.getByText('No recordings yet')).toBeTruthy();
  });
});

describe('App MP4 downloads', () => {
  it('converts the stored recording and downloads it as MP4', async () => {
    await seedRecording({ id: 'take-1', name: 'Standup Demo: 9/9' });
    await renderApp();

    await user().click(
      screen.getByRole('button', { name: 'Download Standup Demo: 9/9 as MP4' })
    );
    await flush();

    expect(converterModule.convertToMP4).toHaveBeenCalledTimes(1);
    expect(browser.downloads).toEqual([
      { href: 'blob:mock-url', download: 'standup_demo__9_9.mp4' },
    ]);
    expect(analyticsModule.track).toHaveBeenCalledWith('Recording Downloaded', undefined);
  });

  it('reports a failed conversion through the header live region', async () => {
    converterModule.convertToMP4.mockRejectedValue(new Error('No H.264 encoder'));
    await seedRecording({ id: 'take-1', name: 'Standup Demo' });
    await renderApp();

    await user().click(screen.getByRole('button', { name: 'Download Standup Demo as MP4' }));
    await flush();

    expect(screen.getByText('Conversion failed: No H.264 encoder')).toBeTruthy();
    expect(browser.downloads).toEqual([]);
  });

  it('offers MP4 disabled while the codec probe is still checking', async () => {
    // Never answers: the button must be disabled *for* the probe rather than
    // enabled and then taken away.
    converterModule.probeMP4Support.mockReturnValue(new Promise(() => {}));
    await seedRecording({ id: 'take-1', name: 'Standup Demo' });
    await renderApp();

    const mp4 = screen.getByRole('button', { name: 'Download Standup Demo as MP4' });
    expect(mp4).toBeDisabled();
    expect(mp4.getAttribute('title')).toContain('Checking');
    // …and says nothing under the library while it waits: a note that appears
    // and vanishes on every load would move the page for no reason.
    expect(screen.queryByText(/Checking whether this browser/)).toBeNull();
    // The instant WebM download never waits on the MP4 question.
    expect(screen.getByRole('button', { name: 'Download Standup Demo' })).toBeEnabled();
  });

  it('offers MP4 without sound, saying so before and after, where there is no AAC encoder', async () => {
    // `convertToMP4` drops the audio and produces a working MP4 here, so the
    // button stays enabled — and the user is told twice: the note under the
    // library before the minutes are spent, the live region after.
    converterModule.probeMP4Support.mockResolvedValue({
      supported: true,
      audio: false,
      reason: 'MP4 will have no audio in this browser (no AAC encoder)',
    });
    await seedRecording({ id: 'take-1', name: 'Standup Demo' });
    await renderApp();

    const mp4 = screen.getByRole('button', { name: 'Download Standup Demo as MP4' });
    expect(mp4).toBeEnabled();
    expect(
      screen.getByText('MP4 will have no audio in this browser (no AAC encoder)')
    ).toBeTruthy();

    await user().click(mp4);
    await flush();

    expect(browser.downloads).toEqual([
      { href: 'blob:mock-url', download: 'standup_demo.mp4' },
    ]);
    expect(
      screen.getByText('Saved as MP4 — without audio: this browser has no AAC encoder')
    ).toBeTruthy();
  });

  it('offers MP4 disabled, with the probe\'s reason, where the browser cannot encode it', async () => {
    converterModule.probeMP4Support.mockResolvedValue({
      supported: false,
      audio: false,
      reason: 'This browser cannot encode H.264 video, which an MP4 needs.',
    });
    await seedRecording({ id: 'take-1', name: 'Standup Demo' });
    await renderApp();

    const mp4 = screen.getByRole('button', { name: 'Download Standup Demo as MP4' });
    expect(mp4).toBeDisabled();
    expect(mp4.getAttribute('title')).toContain('H.264');
    // The instant WebM download is unaffected.
    await user().click(screen.getByRole('button', { name: 'Download Standup Demo' }));
    expect(browser.downloads).toEqual([
      { href: 'blob:mock-url', download: 'standup_demo.webm' },
    ]);
  });
});
