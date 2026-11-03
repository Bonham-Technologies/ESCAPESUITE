// "Float controls" (ESCSUITE-400): the recorder's controls in a Document
// Picture-in-Picture window, so a take of another app can be watched and
// stopped without coming back to this tab.
//
// What is pinned here, through the whole App: the button exists only where the
// API does; the window shows the timer, the meters and the transport buttons,
// wired to the same controller as the page's; R / P / S work inside it; Stop
// there saves the take exactly like Stop on the page; and closing the window
// leaves the take running with the page's controls in step.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRecorderStore } from './store/recorderStore';
import { permissionsOverrides, recorderFactory, resetAppDoubles } from './test/appDoubles';
import {
  renderApp,
  resetRecorderStore,
  installBrowserStubs,
  flush,
  screenStreamDouble,
  micStreamDouble,
  type BrowserStubs,
} from './test/appHarness';
import { installVideoElementDouble, uninstallVideoElementDouble } from './test/doubles/video';
import {
  installDocumentPictureInPicture,
  type DocumentPictureInPictureDouble,
  type FloatingWindowDouble,
} from './test/doubles/documentPictureInPicture';
import { clearAllRecordings } from './test/recordingsDb';
import styles from './App.module.css';

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
let pip: DocumentPictureInPictureDouble | null;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  resetAppDoubles();
  resetRecorderStore({ countdownSeconds: 0, microphoneEnabled: true, systemAudioEnabled: true });
  browser = installBrowserStubs();
  installVideoElementDouble();
  pip = null;
  await clearAllRecordings();
});

afterEach(() => {
  pip?.restore();
  vi.useRealTimers();
  uninstallVideoElementDouble();
  browser.restore();
  vi.restoreAllMocks();
});

const user = () => userEvent.setup();

function armScreenCapture(): void {
  permissionsOverrides.requestScreenCapture.mockResolvedValue(screenStreamDouble({ withAudio: true }).stream);
  permissionsOverrides.requestMicrophone.mockResolvedValue(micStreamDouble().stream);
}

function floatButton(): HTMLElement {
  return screen.getByRole('button', { name: 'Float controls' });
}

async function floatControls(): Promise<FloatingWindowDouble> {
  await user().click(floatButton());
  await flush();
  return pip!.last();
}

/** Queries scoped to the floating window's document. */
function inWindow(floating: FloatingWindowDouble) {
  return within(floating.document.body);
}

function click(element: HTMLElement): void {
  act(() => element.click());
}

describe('App "Float controls" where Document Picture-in-Picture is missing', () => {
  it('draws no button at all', async () => {
    await renderApp();

    expect(screen.getByRole('button', { name: 'Start recording' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Float controls' })).toBeNull();
  });
});

describe('App "Float controls"', () => {
  beforeEach(() => {
    pip = installDocumentPictureInPicture();
  });

  it('opens a 360x160 window holding the transport bar, and shows it pressed', async () => {
    await renderApp();
    expect(floatButton()).toHaveAttribute('aria-pressed', 'false');

    const floating = await floatControls();

    expect(pip!.requestWindow).toHaveBeenCalledWith({ width: 360, height: 160 });
    expect(floatButton()).toHaveAttribute('aria-pressed', 'true');
    const controls = inWindow(floating).getByRole('main', { name: 'Recorder controls' });
    expect(within(controls).getByRole('button', { name: 'Start recording' })).toBeInTheDocument();
    expect(within(controls).getByText('00:00')).toBeInTheDocument();
    // No meters until there is a take to meter.
    expect(floating.document.querySelector(`.${styles.audioMeters}`)).toBeNull();
  });

  it('shows the timer, both meters, Pause, Stop and Cancel during a take', async () => {
    armScreenCapture();
    await renderApp();
    const floating = await floatControls();

    click(inWindow(floating).getByRole('button', { name: 'Start recording' }));
    await flush();
    expect(useRecorderStore.getState().state).toBe('recording');

    act(() => {
      useRecorderStore.setState({ currentDuration: 65, audioLevels: { microphone: 0.5, system: 0.25 } });
    });

    const view = inWindow(floating);
    expect(view.getByText('01:05')).toBeInTheDocument();
    expect(view.getByRole('button', { name: 'Pause recording' })).toBeInTheDocument();
    expect(view.getByRole('button', { name: 'Stop recording' })).toBeInTheDocument();
    expect(view.getByRole('button', { name: 'Cancel recording' })).toBeInTheDocument();
    const fills = [...floating.document.querySelectorAll<HTMLElement>(`.${styles.meterFill}`)];
    expect(fills.map((fill) => fill.style.width)).toEqual(['50%', '25%']);
    expect(view.getByText('Mic')).toBeInTheDocument();
    expect(view.getByText('System')).toBeInTheDocument();
  });

  it('pauses and resumes from the window, and the page follows', async () => {
    armScreenCapture();
    await renderApp();
    const floating = await floatControls();
    click(inWindow(floating).getByRole('button', { name: 'Start recording' }));
    await flush();

    click(inWindow(floating).getByRole('button', { name: 'Pause recording' }));
    await flush();
    expect(useRecorderStore.getState().state).toBe('paused');
    expect(screen.getByRole('button', { name: 'Resume recording' })).toBeInTheDocument();

    click(inWindow(floating).getByRole('button', { name: 'Resume recording' }));
    await flush();
    expect(useRecorderStore.getState().state).toBe('recording');
  });

  it('saves the take when Stop is pressed in the window, as Stop on the page would', async () => {
    armScreenCapture();
    await renderApp();
    const floating = await floatControls();
    click(inWindow(floating).getByRole('button', { name: 'Start recording' }));
    await flush();
    const recorder = recorderFactory.last();

    click(inWindow(floating).getByRole('button', { name: 'Stop recording' }));

    await waitFor(() => expect(useRecorderStore.getState().recordings).toHaveLength(1));
    await waitFor(() => expect(useRecorderStore.getState().state).toBe('idle'));
    expect(recorder.stop).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll('[class*="recordingItem"]')).toHaveLength(1);
    // The window stays up, ready for the next take.
    expect(inWindow(floating).getByRole('button', { name: 'Start recording' })).toBeInTheDocument();
  });

  it('cancels the take from the window', async () => {
    armScreenCapture();
    await renderApp();
    const floating = await floatControls();
    click(inWindow(floating).getByRole('button', { name: 'Start recording' }));
    await flush();

    click(inWindow(floating).getByRole('button', { name: 'Cancel recording' }));
    await flush();

    expect(useRecorderStore.getState().state).toBe('idle');
    expect(useRecorderStore.getState().recordings).toHaveLength(0);
  });

  it('answers R, P and S pressed inside the window', async () => {
    armScreenCapture();
    await renderApp();
    const floating = await floatControls();

    act(() => floating.keydown('r'));
    await flush();
    expect(useRecorderStore.getState().state).toBe('recording');

    act(() => floating.keydown('p'));
    await flush();
    expect(useRecorderStore.getState().state).toBe('paused');

    act(() => floating.keydown('p'));
    await flush();
    expect(useRecorderStore.getState().state).toBe('recording');

    const recorder = recorderFactory.last();
    act(() => floating.keydown('s'));
    await flush();
    expect(recorder.stop).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(useRecorderStore.getState().state).toBe('idle'));
  });

  it('leaves the take recording when the window is closed, with the page controls in step', async () => {
    armScreenCapture();
    await renderApp();
    const floating = await floatControls();
    click(inWindow(floating).getByRole('button', { name: 'Start recording' }));
    await flush();
    const recorder = recorderFactory.last();

    act(() => floating.close());
    await flush();

    expect(useRecorderStore.getState().state).toBe('recording');
    expect(recorder.stop).not.toHaveBeenCalled();
    expect(pip!.pageFocus).toHaveBeenCalledTimes(1);
    expect(floatButton()).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Pause recording' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop recording' })).toBeEnabled();
    // Its keys went with it.
    act(() => floating.keydown('p'));
    await flush();
    expect(useRecorderStore.getState().state).toBe('recording');
  });

  it('closes the window from the page button', async () => {
    await renderApp();
    const floating = await floatControls();

    await user().click(floatButton());
    await flush();

    expect(floating.closed).toBe(true);
    expect(floatButton()).toHaveAttribute('aria-pressed', 'false');
  });
});
