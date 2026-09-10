import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { act, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRecorderStore } from './store/recorderStore';
import {
  permissionsOverrides,
  detectionResult,
  resetAppDoubles,
} from './test/appDoubles';
import {
  renderApp,
  resetRecorderStore,
  installBrowserStubs,
  type BrowserStubs,
} from './test/appHarness';

// Screen/camera capture, WebCodecs muxing, thumbnail decoding, editor
// navigation and analytics delivery are all browser boundaries jsdom does not
// have. Everything of App's own — state machine, config plumbing, rendering —
// runs for real.
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

const { isStandaloneMode } = vi.hoisted(() => ({ isStandaloneMode: vi.fn(() => false) }));
vi.mock('@escapesuite/shared/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@escapesuite/shared/config')>()),
  isStandaloneMode,
}));

let browser: BrowserStubs;

beforeEach(() => {
  resetAppDoubles();
  resetRecorderStore();
  isStandaloneMode.mockReturnValue(false);
  browser = installBrowserStubs();
});

afterEach(() => {
  browser.restore();
  vi.restoreAllMocks();
});

function toggle(label: string): HTMLButtonElement {
  return screen.getByRole('button', { name: label }) as HTMLButtonElement;
}

describe('App capability detection', () => {
  it('asks the browser what it can capture and stores the answer', async () => {
    await renderApp();

    expect(permissionsOverrides.detectCapabilities).toHaveBeenCalledTimes(1);
    expect(useRecorderStore.getState().capabilities.screenCapture).toBe(true);
    expect(toggle('Screen')).toBeEnabled();
    expect(toggle('Webcam')).toBeEnabled();
  });

  it('disables a source the environment cannot provide and explains why', async () => {
    permissionsOverrides.detectCapabilities.mockResolvedValue(
      detectionResult(
        { webcam: false, systemAudio: false },
        {
          webcam: { available: false, reason: 'no_device', message: 'No camera found on this device' },
          systemAudio: {
            available: false,
            reason: 'browser_not_supported',
            message: 'System audio capture is not supported in Firefox',
          },
        }
      )
    );

    await renderApp();

    expect(toggle('Webcam')).toBeDisabled();
    expect(toggle('System Audio')).toBeDisabled();
    expect(toggle('Screen')).toBeEnabled();
    expect(screen.getByTitle('No camera found on this device')).toBeTruthy();
    expect(screen.getByTitle('System audio capture is not supported in Firefox')).toBeTruthy();
  });

  it('locks the source toggles while a recording is in flight', async () => {
    await renderApp();
    act(() => {
      useRecorderStore.getState().setState('recording');
    });

    for (const label of ['Screen', 'Webcam', 'Microphone', 'System Audio']) {
      expect(toggle(label)).toBeDisabled();
    }
  });
});

describe('App source toggles', () => {
  it('turns each source on and off in the store', async () => {
    const user = userEvent.setup();
    await renderApp();

    expect(toggle('Screen')).toHaveAttribute('aria-pressed', 'true');
    await user.click(toggle('Screen'));
    expect(useRecorderStore.getState().config.screenEnabled).toBe(false);
    expect(toggle('Screen')).toHaveAttribute('aria-pressed', 'false');

    await user.click(toggle('Webcam'));
    expect(useRecorderStore.getState().config.webcamEnabled).toBe(true);

    await user.click(toggle('Microphone'));
    expect(useRecorderStore.getState().config.microphoneEnabled).toBe(false);

    await user.click(toggle('System Audio'));
    expect(useRecorderStore.getState().config.systemAudioEnabled).toBe(true);
  });
});

describe('App webcam overlay settings', () => {
  async function renderWithOverlay() {
    resetRecorderStore({ screenEnabled: true, webcamEnabled: true });
    return renderApp();
  }

  it('is hidden unless both screen and webcam are on', async () => {
    await renderApp();
    expect(screen.queryByText('Webcam Overlay')).toBeNull();

    await userEvent.setup().click(toggle('Webcam'));
    expect(screen.getByText('Webcam Overlay')).toBeTruthy();
  });

  it('moves the overlay to the chosen corner', async () => {
    const user = userEvent.setup();
    await renderWithOverlay();

    await user.click(screen.getByRole('button', { name: 'top left' }));
    expect(useRecorderStore.getState().config.webcamPosition).toBe('top-left');

    await user.click(screen.getByRole('button', { name: 'bottom right' }));
    expect(useRecorderStore.getState().config.webcamPosition).toBe('bottom-right');
  });

  it('resizes the overlay from the slider', async () => {
    await renderWithOverlay();
    const slider = screen.getByLabelText('Webcam overlay size');

    act(() => {
      fireEvent.change(slider, { target: { value: '0.35' } });
    });

    expect(useRecorderStore.getState().config.webcamSize).toBe(0.35);
    expect(slider).toHaveValue('0.35');
  });

  it('switches the overlay shape', async () => {
    const user = userEvent.setup();
    await renderWithOverlay();

    await user.click(screen.getByRole('button', { name: 'rectangle' }));
    expect(useRecorderStore.getState().config.webcamShape).toBe('rectangle');

    await user.click(screen.getByRole('button', { name: 'circle' }));
    expect(useRecorderStore.getState().config.webcamShape).toBe('circle');
  });

  it('freezes the overlay controls once recording starts', async () => {
    await renderWithOverlay();
    act(() => {
      useRecorderStore.getState().setState('countdown');
    });

    expect(screen.getByRole('button', { name: 'top left' })).toBeDisabled();
    expect(screen.getByLabelText('Webcam overlay size')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'circle' })).toBeDisabled();
  });
});

describe('App audio meters', () => {
  it('stays hidden until an audio source is armed and recording is live', async () => {
    await renderApp();
    expect(screen.queryByText('Mic')).toBeNull();

    act(() => {
      useRecorderStore.getState().setState('recording');
    });
    expect(screen.getByText('Mic')).toBeTruthy();
    expect(screen.queryByText('System')).toBeNull();
  });

  it('shows a bar per armed source, scaled by the reported level', async () => {
    resetRecorderStore({ microphoneEnabled: true, systemAudioEnabled: true });
    await renderApp();

    act(() => {
      useRecorderStore.getState().setState('recording');
      useRecorderStore.getState().setAudioLevels({ microphone: 0.25, system: 0.5 });
    });

    const fills = document.querySelectorAll<HTMLElement>('[class*="meterFill"]');
    expect(fills).toHaveLength(2);
    expect(fills[0].style.width).toBe('25%');
    expect(fills[1].style.width).toBe('50%');
  });

  it('is not shown at all when both audio sources are off', async () => {
    resetRecorderStore({ microphoneEnabled: false, systemAudioEnabled: false });
    await renderApp();

    act(() => {
      useRecorderStore.getState().setState('recording');
    });

    expect(document.querySelectorAll('[class*="meterFill"]')).toHaveLength(0);
  });
});

describe('App header', () => {
  it('links back to the suite in the hosted build', async () => {
    await renderApp();
    expect(screen.getByTitle('Back to ESCAPE Suite')).toHaveAttribute('href', '/');
  });

  it('drops the suite link in the standalone build', async () => {
    isStandaloneMode.mockReturnValue(true);
    await renderApp();
    expect(screen.queryByTitle('Back to ESCAPE Suite')).toBeNull();
  });

  it('opens the editor in its own named window', async () => {
    await renderApp();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Open Editor in new window' }));

    expect(browser.open).toHaveBeenCalledWith('/artist/', 'escapeartist');
  });

  it('announces the live recording state', async () => {
    await renderApp();
    expect(screen.queryByRole('status')).toBeNull();

    act(() => {
      useRecorderStore.getState().setState('recording');
    });
    expect(screen.getByRole('status')).toHaveTextContent('Recording');

    act(() => {
      useRecorderStore.getState().setState('paused');
    });
    expect(screen.getByRole('status')).toHaveTextContent('Paused');

    act(() => {
      useRecorderStore.getState().setState('saving');
    });
    expect(screen.getByRole('status')).toHaveTextContent('Saving...');
  });
});

describe('App help modal', () => {
  it('opens from the header and closes from its own button', async () => {
    const user = userEvent.setup();
    await renderApp();

    expect(screen.queryByText('Recording Tips')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Help - Recording Tips' }));
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Recording Tips');

    await user.click(screen.getByRole('button', { name: 'Close help' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes on a backdrop click but not on a click inside the panel', async () => {
    const user = userEvent.setup();
    await renderApp();
    await user.click(screen.getByRole('button', { name: 'Help - Recording Tips' }));

    await user.click(screen.getByText('Choosing What to Record'));
    expect(screen.getByRole('dialog')).toBeTruthy();

    await user.click(screen.getByRole('dialog'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('App controls bar', () => {
  it('formats the elapsed time as MM:SS', async () => {
    await renderApp();
    expect(screen.getByText('00:00')).toBeTruthy();

    act(() => {
      useRecorderStore.getState().setCurrentDuration(65.9);
    });
    expect(screen.getByText('01:05')).toBeTruthy();

    act(() => {
      useRecorderStore.getState().setCurrentDuration(3600);
    });
    expect(screen.getByText('60:00')).toBeTruthy();
  });

  it('disables the record button while preparing and while saving', async () => {
    await renderApp();
    const record = () => screen.getByRole('button', { name: /recording$/i });

    act(() => {
      useRecorderStore.getState().setState('preparing');
    });
    expect(record()).toBeDisabled();

    act(() => {
      useRecorderStore.getState().setState('saving');
    });
    expect(record()).toBeDisabled();

    act(() => {
      useRecorderStore.getState().setState('idle');
    });
    expect(record()).toBeEnabled();
  });

  it('offers no cancel button when idle', async () => {
    await renderApp();
    expect(screen.queryByRole('button', { name: 'Cancel recording' })).toBeNull();

    act(() => {
      useRecorderStore.getState().setState('recording');
    });
    expect(screen.getByRole('button', { name: 'Cancel recording' })).toBeTruthy();
  });

  it('shows a placeholder until there is something to preview', async () => {
    await renderApp();
    expect(screen.getByText('Click record to start capturing')).toBeTruthy();
    expect(document.querySelector('video')).toBeNull();
  });

  it('shows the empty state until a recording exists', async () => {
    await renderApp();
    expect(screen.getByText('No recordings yet')).toBeTruthy();
  });
});
