import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRecorderStore } from './store/recorderStore';
import { clearAllRecordings, getVideoBlob, getThumbnail, getRecordingsMetadata } from './core/storage';
import {
  permissionsOverrides,
  recorderFactory,
  thumbnailModule,
  converterModule,
  analyticsModule,
  resetAppDoubles,
} from './test/appDoubles';
import {
  renderApp,
  resetRecorderStore,
  installBrowserStubs,
  installRafDouble,
  uninstallRafDouble,
  flush,
  screenStreamDouble,
  webcamStreamDouble,
  micStreamDouble,
  type BrowserStubs,
} from './test/appHarness';
import {
  installCanvasCaptureStreamDouble,
  uninstallCanvasCaptureStreamDouble,
  getLastCanvasContext,
} from './test/doubles/canvas';
import {
  installVideoElementDouble,
  uninstallVideoElementDouble,
  getLastVideoDouble,
} from './test/doubles/video';

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
let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  resetAppDoubles();
  resetRecorderStore({ countdownSeconds: 0 });
  browser = installBrowserStubs();
  installVideoElementDouble();
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  await clearAllRecordings();
});

afterEach(() => {
  vi.useRealTimers();
  uninstallVideoElementDouble();
  browser.restore();
  vi.restoreAllMocks();
});

const user = () => userEvent.setup();

function recordButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: /^(start|stop) recording$/i }) as HTMLButtonElement;
}

/**
 * Run a whole screen-only take: acquire, start, stop. Returns the capture
 * doubles plus the raw blob the recorder handed over.
 */
async function recordATake(options: { previewWidth?: number; duration?: number } = {}) {
  const screenStream = screenStreamDouble();
  const mic = micStreamDouble();
  permissionsOverrides.requestScreenCapture.mockResolvedValue(screenStream.stream);
  permissionsOverrides.requestMicrophone.mockResolvedValue(mic.stream);

  await renderApp();
  await user().click(recordButton());
  await flush();

  const recorder = recorderFactory.last();
  recorder.duration = options.duration ?? 8;

  // jsdom never gives the preview element intrinsic dimensions; a real one has
  // them as soon as the stream is playing, which is what makes the live
  // thumbnail capture possible.
  const preview = getLastVideoDouble();
  preview?.setMetadata({ videoWidth: options.previewWidth ?? 0, videoHeight: 720 });

  await act(async () => {
    await user().click(recordButton());
    await flush();
  });
  await flush();

  return { screenStream, mic, recorder };
}

function listedRecording(): HTMLElement {
  return document.querySelector('[class*="recordingItem"]') as HTMLElement;
}

describe('App saving a recording', () => {
  it('stores the take and lists it', async () => {
    const { recorder } = await recordATake({ duration: 8 });

    expect(useRecorderStore.getState().state).toBe('idle');
    expect(analyticsModule.track).toHaveBeenCalledWith('Recording Completed', { duration: 8 });

    const listed = listedRecording();
    expect(listed).toBeTruthy();
    expect(listed.textContent).toContain('00:08');

    const [meta] = await getRecordingsMetadata();
    expect(meta).toMatchObject({
      duration: 8,
      width: 1920,
      height: 1080,
      frameRate: 30,
      source: 'recording',
      mediaType: 'video',
    });
    expect(meta.name).toBe(useRecorderStore.getState().recordings[0].name);
    // fake-indexeddb does not round-trip Blobs faithfully, so assert presence.
    await expect(getVideoBlob(meta.id)).resolves.toBeDefined();
    await expect(getThumbnail(meta.id)).resolves.toBeDefined();
    expect(recorder.stop).toHaveBeenCalledTimes(1);
  });

  it('repairs the WebM metadata a MediaRecorder take is missing', async () => {
    recorderFactory.recorderType = 'mediarecorder';
    const { recorder } = await recordATake();

    expect(converterModule.fixWebMMetadata).toHaveBeenCalledWith(recorder.stopBlob);
    expect(thumbnailModule.extractVideoMetadata).toHaveBeenCalledWith(expect.any(Blob), 8);
  });

  it('leaves a WebCodecs take alone — it is already seekable', async () => {
    recorderFactory.recorderType = 'webcodecs';
    const { recorder } = await recordATake();

    expect(converterModule.fixWebMMetadata).not.toHaveBeenCalled();
    expect(thumbnailModule.extractVideoMetadata).toHaveBeenCalledWith(recorder.stopBlob, 8);
  });

  it('keeps the raw take when the metadata repair fails', async () => {
    converterModule.fixWebMMetadata.mockRejectedValue(new Error('remux failed'));
    const { recorder } = await recordATake();

    expect(thumbnailModule.extractVideoMetadata).toHaveBeenCalledWith(recorder.stopBlob, 8);
    expect(listedRecording()).toBeTruthy();
  });

  it('falls back to the timed duration when the file reports none', async () => {
    thumbnailModule.extractVideoMetadata.mockResolvedValue({ duration: 0, width: 640, height: 480 });
    await recordATake({ duration: 95 });

    expect(listedRecording().textContent).toContain('01:35');
    const [meta] = await getRecordingsMetadata();
    expect(meta.duration).toBe(95);
  });

  it('falls back to the ticked duration when the recorder reports none', async () => {
    const screenStream = screenStreamDouble();
    permissionsOverrides.requestScreenCapture.mockResolvedValue(screenStream.stream);
    permissionsOverrides.requestMicrophone.mockResolvedValue(micStreamDouble().stream);
    await renderApp();
    await user().click(recordButton());
    await flush();

    const recorder = recorderFactory.last();
    recorder.duration = 42;
    act(() => {
      vi.advanceTimersByTime(100); // the ticker records 42s in the store
    });
    recorder.duration = 0; // ...then the recorder forgets it, as a torn-down one does

    await act(async () => {
      await user().click(recordButton());
      await flush();
    });
    await flush();

    expect(analyticsModule.track).toHaveBeenCalledWith('Recording Completed', { duration: 42 });
  });

  it('reports a save failure and returns to idle', async () => {
    thumbnailModule.extractVideoMetadata.mockRejectedValue(new Error('cannot decode'));
    await recordATake();

    expect(consoleError).toHaveBeenCalledWith('Failed to save recording:', expect.any(Error));
    expect(useRecorderStore.getState().state).toBe('idle');
    expect(screen.getByText('No recordings yet')).toBeTruthy();
  });

  it('releases the capture streams once the take is finished', async () => {
    const { screenStream } = await recordATake();

    expect(screenStream.video!.stop).toHaveBeenCalledTimes(1);
    expect(useRecorderStore.getState().screenStream).toBeNull();
    expect(screen.getByText('Click record to start capturing')).toBeTruthy();
  });
});

describe('App recording thumbnails', () => {
  it('grabs the thumbnail from the live preview when it has frames', async () => {
    await recordATake({ previewWidth: 1280 });

    expect(thumbnailModule.generateThumbnail).not.toHaveBeenCalled();
    const drawn = getLastCanvasContext()!;
    expect(drawn.canvas.width).toBe(320);
    expect(drawn.canvas.height).toBe(180);
    expect(drawn.toBlobCalls).toContainEqual({ type: 'image/jpeg', quality: 0.8 });
  });

  it('decodes one from the file when the preview had no frames', async () => {
    await recordATake({ previewWidth: 0 });

    expect(thumbnailModule.generateThumbnail).toHaveBeenCalledTimes(1);
    const [meta] = await getRecordingsMetadata();
    await expect(getThumbnail(meta.id)).resolves.toBeDefined();
  });

  it('draws a placeholder when the file cannot be decoded either', async () => {
    thumbnailModule.generateThumbnail.mockRejectedValue(new Error('no decoder'));
    await recordATake({ previewWidth: 0 });

    const placeholder = getLastCanvasContext()!;
    expect(placeholder.calls.map(c => c.method)).toEqual(['fillRect', 'fillText']);
    const [meta] = await getRecordingsMetadata();
    await expect(getThumbnail(meta.id)).resolves.toBeDefined();
    expect(listedRecording()).toBeTruthy();
  });
});

describe('App picture-in-picture saving', () => {
  beforeEach(() => {
    installCanvasCaptureStreamDouble();
    installRafDouble();
  });

  afterEach(() => {
    uninstallRafDouble();
    uninstallCanvasCaptureStreamDouble();
  });

  it('grabs the thumbnail from the compositor canvas rather than a preview element', async () => {
    const screenStream = screenStreamDouble();
    const webcam = webcamStreamDouble();
    permissionsOverrides.requestScreenCapture.mockResolvedValue(screenStream.stream);
    permissionsOverrides.requestWebcam.mockResolvedValue(webcam.stream);
    resetRecorderStore({ screenEnabled: true, webcamEnabled: true, countdownSeconds: 0 });

    await renderApp();
    await user().click(recordButton());
    await flush();
    recorderFactory.last().duration = 5;

    await act(async () => {
      await user().click(recordButton());
      await flush();
    });
    await flush();

    expect(thumbnailModule.generateThumbnail).not.toHaveBeenCalled();
    const thumbCanvas = getLastCanvasContext()!;
    expect(thumbCanvas.canvas.width).toBe(320);
    expect(thumbCanvas.drawImage).toHaveBeenCalledWith(expect.any(HTMLCanvasElement), 0, 0, 320, 180);

    const [meta] = await getRecordingsMetadata();
    expect(meta.duration).toBe(5);
  });
});
