// ESCSUITE-176 item 3 (probe m3). The separate-tracks storage headroom check
// (`hasSeparateTracksSpace`, roughly double a plain take —
// `SEPARATE_TRACKS_SIZE_FACTOR` in `store/recorderStore.ts`) used to reach
// only the toggle: it can refuse switching the mode *on*, but not a take
// already configured for it, so the Record button stayed live and the take
// started at double the size it had room for.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { act, screen } from '@testing-library/react';
import { useRecorderStore } from './store/recorderStore';
import { resetAppDoubles } from './test/appDoubles';
import {
  renderApp,
  resetRecorderStore,
  installBrowserStubs,
  flush,
  type BrowserStubs,
} from './test/appHarness';

vi.mock('./core/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./core/permissions')>();
  const { permissionsOverrides } = await import('./test/appDoubles');
  return { ...actual, ...permissionsOverrides };
});
vi.mock('./core/recorder-factory', async () => (await import('./test/appDoubles')).recorderFactoryModule);
vi.mock('./core/thumbnailGenerator', async () => (await import('./test/appDoubles')).thumbnailModule);
vi.mock('./core/converter', async () => (await import('./test/appDoubles')).converterModule);
vi.mock('./utils/sendToEditor', async () => (await import('./test/appDoubles')).sendToEditorModule);
vi.mock('@vercel/analytics', async () => (await import('./test/appDoubles')).analyticsModule);

let browser: BrowserStubs;

beforeEach(() => {
  resetAppDoubles();
  resetRecorderStore();
  browser = installBrowserStubs();
});

afterEach(() => {
  browser.restore();
  vi.restoreAllMocks();
});

function recordButton(): HTMLButtonElement {
  return screen.getByRole('button', {
    name: /^(start recording|stop recording|cancel countdown)$/i,
  }) as HTMLButtonElement;
}

describe('PROBE: starting a separate-tracks take with room for only one track', () => {
  it('refuses the take, with the reason the toggle already knows', async () => {
    resetRecorderStore({
      screenEnabled: true,
      webcamEnabled: true,
      microphoneEnabled: false,
      separateTracks: true,
    });
    await renderApp();
    await act(async () => {
      useRecorderStore.setState({ hasStorageSpace: true, hasSeparateTracksSpace: false });
    });
    await flush();

    expect(recordButton().disabled).toBe(true);
    expect(recordButton()).toHaveAccessibleDescription(
      'Not enough storage for separate tracks — delete a recording first.'
    );
  });
});
