import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRecorderStore } from './store/recorderStore';
import {
  permissionsOverrides,
  recorderFactory,
  analyticsModule,
  detectionResult,
  resetAppDoubles,
} from './test/appDoubles';
import {
  renderApp,
  resetRecorderStore,
  installBrowserStubs,
  installRafDouble,
  uninstallRafDouble,
  tickAnimationFrames,
  pendingAnimationFrames,
  flush,
  screenStreamDouble,
  webcamStreamDouble,
  micStreamDouble,
  type BrowserStubs,
} from './test/appHarness';
import {
  installCanvasCaptureStreamDouble,
  uninstallCanvasCaptureStreamDouble,
} from './test/doubles/canvas';
import { installVideoElementDouble, uninstallVideoElementDouble } from './test/doubles/video';
import { createStreamDouble, createTrackDouble } from './test/doubles/mediastream';

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
  // Only the interval timers are faked: the countdown and the duration ticker
  // are the app's own, while setTimeout stays real so IndexedDB and
  // user-event keep working.
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  resetAppDoubles();
  resetRecorderStore();
  browser = installBrowserStubs();
  installVideoElementDouble();
});

afterEach(() => {
  vi.useRealTimers();
  uninstallVideoElementDouble();
  browser.restore();
  vi.restoreAllMocks();
});

const user = () => userEvent.setup();

/**
 * Silence one expected console.error for the duration of a single test, so an
 * unexpected one elsewhere still reaches the reporter.
 */
function expectedConsoleError(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(console, 'error').mockImplementation(() => {});
}

function recordButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: /^(start|stop) recording$/i }) as HTMLButtonElement;
}

function state(): string {
  return useRecorderStore.getState().state;
}

/** Arm the capture doubles for a screen-only recording. */
function armScreenCapture(options: { withAudio?: boolean } = {}) {
  const screenStream = screenStreamDouble(options);
  const mic = micStreamDouble();
  permissionsOverrides.requestScreenCapture.mockResolvedValue(screenStream.stream);
  permissionsOverrides.requestMicrophone.mockResolvedValue(mic.stream);
  return { screenStream, mic };
}

async function startRecordingViaButton(): Promise<void> {
  await user().click(recordButton());
  await flush();
}

describe('App start recording', () => {
  it('acquires only the enabled sources and hands them to a fresh recorder', async () => {
    const { screenStream, mic } = armScreenCapture();
    resetRecorderStore({ screenEnabled: true, webcamEnabled: false, microphoneEnabled: true, systemAudioEnabled: true });
    await renderApp();

    await startRecordingViaButton();

    expect(permissionsOverrides.requestScreenCapture).toHaveBeenCalledWith(true);
    expect(permissionsOverrides.requestWebcam).not.toHaveBeenCalled();
    expect(permissionsOverrides.requestMicrophone).toHaveBeenCalledTimes(1);

    expect(recorderFactory.createRecorder).toHaveBeenCalledTimes(1);
    expect(recorderFactory.last().isPiP).toBe(false);
    expect(recorderFactory.last().initializeCalls).toEqual([
      {
        screen: screenStream.stream,
        webcam: null,
        mic: mic.stream,
        config: useRecorderStore.getState().config,
      },
    ]);
    expect(useRecorderStore.getState().screenStream).toBe(screenStream.stream);
  });

  it('skips a source the environment cannot provide even when it is toggled on', async () => {
    armScreenCapture();
    resetRecorderStore({ screenEnabled: true, webcamEnabled: true, microphoneEnabled: true });
    permissionsOverrides.detectCapabilities.mockResolvedValue(
      detectionResult({ webcam: false, microphone: false, systemAudio: false })
    );
    await renderApp();

    await startRecordingViaButton();

    expect(permissionsOverrides.requestWebcam).not.toHaveBeenCalled();
    expect(permissionsOverrides.requestMicrophone).not.toHaveBeenCalled();
    expect(recorderFactory.last().initializeCalls[0].webcam).toBeNull();
    expect(recorderFactory.last().initializeCalls[0].mic).toBeNull();
  });

  it('previews a webcam-only recording from the webcam stream', async () => {
    const webcam = webcamStreamDouble();
    permissionsOverrides.requestWebcam.mockResolvedValue(webcam.stream);
    resetRecorderStore({ screenEnabled: false, webcamEnabled: true, microphoneEnabled: false });
    await renderApp();

    await startRecordingViaButton();

    const preview = document.querySelector('video') as HTMLVideoElement & { srcObject?: MediaStream };
    expect(preview).toBeTruthy();
    expect(preview.srcObject).toBe(webcam.stream);
    expect(recorderFactory.last().initializeCalls[0]).toMatchObject({
      screen: null,
      webcam: webcam.stream,
      mic: null,
    });
  });

  it('reports the failure and returns to idle when capture is refused', async () => {
    const consoleError = expectedConsoleError();
    permissionsOverrides.requestScreenCapture.mockRejectedValue(new Error('Permission denied'));
    await renderApp();

    await startRecordingViaButton();

    expect(state()).toBe('idle');
    expect(recorderFactory.createRecorder).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith('Failed to start recording:', expect.any(Error));
  });

  it('releases the streams it already got when a later source fails', async () => {
    const consoleError = expectedConsoleError();
    const screenStream = screenStreamDouble();
    permissionsOverrides.requestScreenCapture.mockResolvedValue(screenStream.stream);
    permissionsOverrides.requestWebcam.mockRejectedValue(new Error('Camera in use'));
    resetRecorderStore({ screenEnabled: true, webcamEnabled: true });
    await renderApp();

    await startRecordingViaButton();

    expect(screenStream.video!.stop).toHaveBeenCalledTimes(1);
    expect(state()).toBe('idle');
    expect(consoleError).toHaveBeenCalledWith('Failed to start recording:', expect.any(Error));
  });

  it('starts immediately when the countdown is switched off', async () => {
    armScreenCapture();
    resetRecorderStore({ countdownSeconds: 0 });
    await renderApp();

    await startRecordingViaButton();

    expect(state()).toBe('recording');
    expect(recorderFactory.last().start).toHaveBeenCalledTimes(1);
    expect(analyticsModule.track).toHaveBeenCalledWith('Recording Started', undefined);
    expect(screen.getByRole('status')).toHaveTextContent('Recording');
  });
});

describe('App countdown', () => {
  it('counts down to the recorder start, one second at a time', async () => {
    armScreenCapture();
    resetRecorderStore({ countdownSeconds: 3 });
    await renderApp();

    await startRecordingViaButton();

    expect(state()).toBe('countdown');
    expect(screen.getByText('3')).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText('2')).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText('1')).toBeTruthy();
    expect(recorderFactory.last().start).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(recorderFactory.last().start).toHaveBeenCalledTimes(1);
    expect(state()).toBe('recording');
    expect(document.querySelector('[class*="countdownNumber"]')).toBeNull();
  });

  it('abandons the countdown and releases the streams when cancelled', async () => {
    const { screenStream } = armScreenCapture();
    await renderApp();
    await startRecordingViaButton();

    await user().click(screen.getByRole('button', { name: 'Cancel recording' }));

    expect(state()).toBe('idle');
    expect(screenStream.video!.stop).toHaveBeenCalledTimes(1);
    expect(useRecorderStore.getState().screenStream).toBeNull();

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(recorderFactory.last().start).not.toHaveBeenCalled();
  });

  it('cancels the countdown on Escape', async () => {
    armScreenCapture();
    await renderApp();
    await startRecordingViaButton();

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(state()).toBe('idle');
  });
});

describe('App recording controls', () => {
  async function startLiveRecording() {
    const streams = armScreenCapture();
    resetRecorderStore({ countdownSeconds: 0 });
    await renderApp();
    await startRecordingViaButton();
    return streams;
  }

  it('ticks the elapsed time from the recorder while recording', async () => {
    await startLiveRecording();
    const recorder = recorderFactory.last();

    recorder.duration = 1.2;
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(screen.getByText('00:01')).toBeTruthy();

    recorder.duration = 62;
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(screen.getByText('01:02')).toBeTruthy();
  });

  it('pauses and resumes from the control button', async () => {
    await startLiveRecording();
    const recorder = recorderFactory.last();

    await user().click(screen.getByRole('button', { name: 'Pause recording' }));
    expect(recorder.pause).toHaveBeenCalledTimes(1);
    expect(state()).toBe('paused');
    expect(screen.getByRole('status')).toHaveTextContent('Paused');

    await user().click(screen.getByRole('button', { name: 'Resume recording' }));
    expect(recorder.resume).toHaveBeenCalledTimes(1);
    expect(state()).toBe('recording');
  });

  it('pauses and resumes from the P shortcut', async () => {
    await startLiveRecording();
    const recorder = recorderFactory.last();

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'P' }));
    });
    expect(state()).toBe('paused');

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p' }));
    });
    expect(state()).toBe('recording');
    expect(recorder.resume).toHaveBeenCalledTimes(1);
  });

  it('throws the recording away when cancelled mid-take', async () => {
    const { screenStream } = await startLiveRecording();
    const recorder = recorderFactory.last();
    recorder.duration = 12;
    act(() => {
      vi.advanceTimersByTime(100);
    });

    await user().click(screen.getByRole('button', { name: 'Cancel recording' }));

    expect(recorder.dispose).toHaveBeenCalledTimes(1);
    expect(recorder.stop).not.toHaveBeenCalled();
    expect(state()).toBe('idle');
    expect(screen.getByText('00:00')).toBeTruthy();
    expect(screenStream.video!.stop).toHaveBeenCalledTimes(1);

    // The duration ticker is gone with it.
    recorder.duration = 30;
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText('00:00')).toBeTruthy();
  });

  it('cancels a live recording on Escape', async () => {
    await startLiveRecording();

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(recorderFactory.last().dispose).toHaveBeenCalledTimes(1);
    expect(state()).toBe('idle');
  });

  it('surfaces a recorder failure and cleans up after it', async () => {
    const { screenStream } = await startLiveRecording();
    const consoleError = expectedConsoleError();

    act(() => {
      recorderFactory.last().failWith(new Error('encoder died'));
    });

    expect(consoleError).toHaveBeenCalledWith('Recording error:', expect.any(Error));
    expect(state()).toBe('idle');
    expect(screenStream.video!.stop).toHaveBeenCalledTimes(1);
  });

  it('feeds the audio meters from the recorder', async () => {
    await startLiveRecording();

    act(() => {
      recorderFactory.last().emitAudioLevels({ microphone: 0.4, system: 0 });
    });

    expect(useRecorderStore.getState().audioLevels).toEqual({ microphone: 0.4, system: 0 });
    const fill = document.querySelector('[class*="meterFill"]') as HTMLElement;
    expect(fill.style.width).toBe('40%');
  });
});

describe('App keyboard shortcuts', () => {
  it('starts a recording with R and stops it with S', async () => {
    armScreenCapture();
    resetRecorderStore({ countdownSeconds: 0 });
    await renderApp();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' }));
      await flush();
    });
    expect(state()).toBe('recording');

    const recorder = recorderFactory.last();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 's' }));
      await flush();
    });
    expect(recorder.stop).toHaveBeenCalledTimes(1);
  });

  it('does nothing for R while a recording is already running', async () => {
    armScreenCapture();
    resetRecorderStore({ countdownSeconds: 0 });
    await renderApp();
    await startRecordingViaButton();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' }));
      await flush();
    });

    expect(recorderFactory.createRecorder).toHaveBeenCalledTimes(1);
  });

  it('ignores S and P when idle, and unrelated keys always', async () => {
    armScreenCapture();
    await renderApp();

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 's' }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p' }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'x' }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(state()).toBe('idle');
    expect(recorderFactory.createRecorder).not.toHaveBeenCalled();
  });

  it('stays out of the way while the user is typing', async () => {
    armScreenCapture();
    resetRecorderStore({ screenEnabled: true, webcamEnabled: true, countdownSeconds: 0 });
    await renderApp();
    const slider = screen.getByLabelText('Webcam overlay size');

    await act(async () => {
      slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }));
      await flush();
    });

    expect(recorderFactory.createRecorder).not.toHaveBeenCalled();
  });

  it('stops listening once the app unmounts', async () => {
    armScreenCapture();
    resetRecorderStore({ countdownSeconds: 0 });
    const { unmount } = await renderApp();
    unmount();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' }));
      await flush();
    });

    expect(recorderFactory.createRecorder).not.toHaveBeenCalled();
  });
});

describe('App picture-in-picture', () => {
  beforeEach(() => {
    installCanvasCaptureStreamDouble();
    installRafDouble();
  });

  afterEach(() => {
    uninstallRafDouble();
    uninstallCanvasCaptureStreamDouble();
  });

  it('composites screen and webcam and records the composed stream', async () => {
    const screenStream = screenStreamDouble({ withAudio: true, width: 1920, height: 1080 });
    const webcam = webcamStreamDouble();
    permissionsOverrides.requestScreenCapture.mockResolvedValue(screenStream.stream);
    permissionsOverrides.requestWebcam.mockResolvedValue(webcam.stream);
    resetRecorderStore({
      screenEnabled: true,
      webcamEnabled: true,
      microphoneEnabled: false,
      systemAudioEnabled: true,
      countdownSeconds: 0,
      webcamPosition: 'top-left',
      webcamSize: 0.3,
      webcamShape: 'rectangle',
    });
    await renderApp();

    await startRecordingViaButton();

    // The compositor canvas is shown directly instead of a <video> preview.
    const canvas = document.querySelector('[class*="preview"] canvas') as HTMLCanvasElement;
    expect(canvas).toBeTruthy();
    expect(canvas.width).toBe(1280); // 1080p capped to 720p by the compositor
    expect(canvas.style.objectFit).toBe('contain');
    expect(pendingAnimationFrames()).toBeGreaterThan(0);

    expect(recorderFactory.createRecorder).toHaveBeenCalledWith(expect.any(Object), true);
    expect(recorderFactory.last().isPiP).toBe(true);

    // The recorder gets the composited video plus the screen's own audio —
    // not the raw screen video.
    const initialized = recorderFactory.last().initializeCalls[0];
    expect(initialized.screen).not.toBe(screenStream.stream);
    expect(initialized.screen!.getVideoTracks()[0].id).toBe('canvas-video-track');
    expect(initialized.screen!.getAudioTracks()).toEqual([screenStream.audio]);
    expect(initialized.webcam).toBe(webcam.stream);
  });

  it('falls back to 1080p when the screen track reports no dimensions', async () => {
    const bareTrack = createTrackDouble('video', { id: 'screen-video', settings: {} });
    const webcam = webcamStreamDouble();
    permissionsOverrides.requestScreenCapture.mockResolvedValue(createStreamDouble([bareTrack]));
    permissionsOverrides.requestWebcam.mockResolvedValue(webcam.stream);
    resetRecorderStore({ screenEnabled: true, webcamEnabled: true, countdownSeconds: 0 });
    await renderApp();

    await startRecordingViaButton();

    const canvas = document.querySelector('[class*="preview"] canvas') as HTMLCanvasElement;
    expect(canvas.width).toBe(1280);
    expect(canvas.height).toBe(720);
  });

  it('tears the compositor down when the recording is cancelled', async () => {
    const screenStream = screenStreamDouble();
    const webcam = webcamStreamDouble();
    permissionsOverrides.requestScreenCapture.mockResolvedValue(screenStream.stream);
    permissionsOverrides.requestWebcam.mockResolvedValue(webcam.stream);
    resetRecorderStore({ screenEnabled: true, webcamEnabled: true, countdownSeconds: 0 });
    await renderApp();
    await startRecordingViaButton();

    tickAnimationFrames();
    expect(pendingAnimationFrames()).toBe(1);

    await user().click(screen.getByRole('button', { name: 'Cancel recording' }));

    expect(pendingAnimationFrames()).toBe(0);
    expect(document.querySelector('[class*="preview"] canvas')).toBeNull();
    expect(screen.getByText('Click record to start capturing')).toBeTruthy();
  });
});
