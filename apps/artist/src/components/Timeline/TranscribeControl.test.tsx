// ESCSUITE-404: "Transcribe to captions" in the timeline's controls. It exists
// only where the browser can recognise speech on this device, asks before a
// language pack is downloaded, and lands its cues as caption clips in one
// undo step.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LANGUAGE_PACK_NOTICE, TranscribeControl } from './TranscribeControl';
import { useEditorStore } from '../../store/projectStore';
import { resetStoreForTest, store } from '../../test/fixtures/projectStore';
import { serializeCaptions } from '../../core/captions';
import type { CaptionCue } from '../../core/captions';
import type { TranscribeTimelineOptions } from '../../core/transcribe';

const transcribeTimeline = vi.fn<(options: TranscribeTimelineOptions) => Promise<CaptionCue[] | null>>();
vi.mock('../../core/transcribe', () => ({
  transcribeTimeline: (options: TranscribeTimelineOptions) => transcribeTimeline(options),
}));

const available = vi.fn<(options: unknown) => Promise<string>>();
const install = vi.fn<(options: unknown) => Promise<boolean>>();

function installRecognition() {
  function SpeechRecognition() {}
  Object.defineProperty(SpeechRecognition.prototype, 'processLocally', { value: false, writable: true });
  Object.assign(SpeechRecognition, { available, install });
  vi.stubGlobal('SpeechRecognition', SpeechRecognition);
  return SpeechRecognition;
}

const STUB_WORDS: CaptionCue[] = [
  { start: 0.7, end: 3, text: 'the quick brown fox' },
  { start: 4.7, end: 7, text: 'jumps over the lazy dog' },
];

function renderControl() {
  const showNotification = vi.fn();
  const view = render(<TranscribeControl showNotification={showNotification} />);
  return { showNotification, ...view };
}

const button = () => screen.queryByRole('button', { name: 'Transcribe to captions' });
const captionClips = () => {
  const { tracks, clips } = useEditorStore.getState().project.timeline;
  const captionTrack = tracks.find((t) => t.kind === 'captions');
  return captionTrack ? clips.filter((c) => c.trackId === captionTrack.id) : [];
};

beforeEach(() => {
  resetStoreForTest();
  available.mockReset();
  install.mockReset();
  transcribeTimeline.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TranscribeControl: where it is offered (ESCSUITE-404)', () => {
  it('renders nothing where the browser has no speech recognition (Firefox, Safari)', async () => {
    vi.stubGlobal('SpeechRecognition', undefined);
    vi.stubGlobal('webkitSpeechRecognition', undefined);
    const { container } = renderControl();
    await act(async () => {});
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for a recogniser with no on-device mode', async () => {
    function webkitSpeechRecognition() {}
    vi.stubGlobal('SpeechRecognition', undefined);
    vi.stubGlobal('webkitSpeechRecognition', webkitSpeechRecognition);
    const { container } = renderControl();
    await act(async () => {});
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing in a bare Chromium embedder (Electron, the headless shell), even with the API', async () => {
    installRecognition();
    vi.stubGlobal('navigator', {
      ...navigator,
      language: navigator.language,
      userAgentData: { brands: [{ brand: 'Chromium', version: '139' }, { brand: 'Not_A Brand', version: '8' }] },
    });
    const { container } = renderControl();
    await act(async () => {});
    expect(container).toBeEmptyDOMElement();
    expect(available).not.toHaveBeenCalled();
  });

  it('is offered on static detection alone, and asks the browser nothing until pressed', async () => {
    // available() kills the renderer in a bare Chromium embedder, so opening
    // the editor must never call it: only a press does.
    installRecognition();
    available.mockResolvedValue('available');
    renderControl();
    expect(screen.getByRole('button', { name: 'Transcribe to captions' })).toBeEnabled();
    await act(async () => {});
    expect(available).not.toHaveBeenCalled();
    expect(install).not.toHaveBeenCalled();
  });

  it('asks available() on the press, on device, and hides itself when it answers unavailable (Chrome on Android, ChromeOS)', async () => {
    const user = userEvent.setup();
    installRecognition();
    available.mockResolvedValue('unavailable');
    const { container, showNotification } = renderControl();
    await user.click(screen.getByRole('button', { name: 'Transcribe to captions' }));
    expect(available).toHaveBeenCalledTimes(1);
    expect(available).toHaveBeenCalledWith({ langs: [navigator.language], processLocally: true });
    expect(showNotification).toHaveBeenCalledWith('On-device speech recognition is not available in this browser.', 'info');
    expect(container).toBeEmptyDOMElement();
    expect(install).not.toHaveBeenCalled();
    expect(transcribeTimeline).not.toHaveBeenCalled();
  });

  it('loads no transcription code until it is pressed', async () => {
    installRecognition();
    available.mockResolvedValue('available');
    renderControl();
    await screen.findByRole('button', { name: 'Transcribe to captions' });
    expect(transcribeTimeline).not.toHaveBeenCalled();
  });
});

describe('TranscribeControl: transcribing (ESCSUITE-404)', () => {
  it("lands the recogniser's words on the Captions track as ordinary caption clips, in one undo step", async () => {
    const user = userEvent.setup();
    const Recognition = installRecognition();
    available.mockResolvedValue('available');
    transcribeTimeline.mockResolvedValue(STUB_WORDS);
    const { showNotification } = renderControl();
    const historyBefore = useEditorStore.getState().history.past.length;

    await user.click((await screen.findByRole('button', { name: 'Transcribe to captions' }))!);

    await waitFor(() => expect(captionClips()).toHaveLength(2));
    expect(transcribeTimeline).toHaveBeenCalledWith(
      expect.objectContaining({ lang: navigator.language, Recognition })
    );
    expect(captionClips().map((c) => c.textData?.text)).toEqual(['the quick brown fox', 'jumps over the lazy dog']);
    expect(captionClips().map((c) => [c.timelinePosition, c.duration])).toEqual([
      [0.7, 2.3],
      [4.7, expect.closeTo(2.3, 6)],
    ]);
    expect(captionClips().every((c) => c.overlayType === 'text')).toBe(true);
    expect(useEditorStore.getState().history.past.length).toBe(historyBefore + 1);
    expect(showNotification).toHaveBeenCalledWith('Transcribed 2 captions onto the Captions track.', 'success');

    // The sidecar writes them like any imported caption.
    const srt = serializeCaptions(
      captionClips().map((c) => ({ start: c.timelinePosition, end: c.timelinePosition + c.duration, text: c.textData!.text })),
      'srt'
    );
    expect(srt).toContain('the quick brown fox');
    expect(srt).toContain('00:00:00,700 --> 00:00:03,000');

    store().undo();
    expect(captionClips()).toHaveLength(0);
    expect(button()).toBeEnabled();
    expect(button()).toHaveFocus();
  });

  it('says so when the timeline has no sound, or no speech was heard', async () => {
    const user = userEvent.setup();
    installRecognition();
    available.mockResolvedValue('available');
    transcribeTimeline.mockResolvedValueOnce(null).mockResolvedValueOnce([]);
    const { showNotification } = renderControl();

    await user.click((await screen.findByRole('button', { name: 'Transcribe to captions' }))!);
    await waitFor(() => expect(showNotification).toHaveBeenCalledWith('There is no sound on the timeline to transcribe.', 'info'));
    await user.click(button()!);
    await waitFor(() => expect(showNotification).toHaveBeenCalledWith('No speech was heard, so no captions were added.', 'info'));
    expect(captionClips()).toHaveLength(0);
  });

  it('shows progress and can be stopped, adding nothing', async () => {
    const user = userEvent.setup();
    installRecognition();
    available.mockResolvedValue('available');
    transcribeTimeline.mockImplementation(({ signal, onProgress }) => {
      onProgress?.('mixing', 0, 10);
      onProgress?.('listening', 4.2, 10);
      return new Promise((_, reject) => {
        signal!.addEventListener('abort', () => reject(new DOMException('stopped', 'AbortError')));
      });
    });
    const { showNotification } = renderControl();

    await user.click((await screen.findByRole('button', { name: 'Transcribe to captions' }))!);
    expect(await screen.findByText('Transcribing on this device…')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByText('0:04 / 0:10')).not.toHaveAttribute('aria-live');
    // The same button, so keyboard focus stays on it.
    expect(screen.getByRole('button', { name: 'Stop transcribing' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Stop transcribing' }));

    await waitFor(() => expect(showNotification).toHaveBeenCalledWith('Transcription stopped. No captions were added.', 'info'));
    expect(captionClips()).toHaveLength(0);
    expect(button()).toBeEnabled();
  });

  it('shows the preparing line while the sound is mixed', async () => {
    const user = userEvent.setup();
    installRecognition();
    available.mockResolvedValue('available');
    transcribeTimeline.mockImplementation(() => new Promise(() => {}));
    renderControl();
    await user.click((await screen.findByRole('button', { name: 'Transcribe to captions' }))!);
    expect(await screen.findByText('Preparing the sound…')).toHaveAttribute('aria-live', 'polite');
  });

  it("shows a recogniser's error in its own words, and any other failure generically", async () => {
    const user = userEvent.setup();
    installRecognition();
    available.mockResolvedValue('available');
    const recognitionError = Object.assign(new Error('The speech language pack for this language is not installed on this device.'), {
      name: 'TranscriptionError',
    });
    transcribeTimeline.mockRejectedValueOnce(recognitionError).mockRejectedValueOnce(new Error('boom'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { showNotification } = renderControl();

    await user.click((await screen.findByRole('button', { name: 'Transcribe to captions' }))!);
    await waitFor(() => expect(showNotification).toHaveBeenCalledWith(recognitionError.message, 'error'));
    await user.click(button()!);
    await waitFor(() => expect(showNotification).toHaveBeenCalledWith('Could not transcribe the timeline.', 'error'));
    consoleError.mockRestore();
  });

  it('refuses before listening when the Captions track is locked', async () => {
    const user = userEvent.setup();
    installRecognition();
    available.mockResolvedValue('available');
    store().addCaptionCues([{ start: 0, end: 1, text: 'existing' }], { fontSize: 40 } as never);
    const captions = useEditorStore.getState().project.timeline.tracks.find((t) => t.kind === 'captions')!;
    store().updateTrack(captions.id, { locked: true });
    const { showNotification } = renderControl();

    await user.click((await screen.findByRole('button', { name: 'Transcribe to captions' }))!);
    expect(showNotification).toHaveBeenCalledWith('The Captions track is locked, so no captions were added.', 'error');
    expect(transcribeTimeline).not.toHaveBeenCalled();
  });

  it('refuses at the end when the Captions track was locked while it listened', async () => {
    const user = userEvent.setup();
    installRecognition();
    available.mockResolvedValue('available');
    transcribeTimeline.mockImplementation(async () => {
      act(() => {
        useEditorStore.getState().addCaptionCues([{ start: 0, end: 1, text: 'meanwhile' }], { fontSize: 40 } as never);
        const captions = useEditorStore.getState().project.timeline.tracks.find((t) => t.kind === 'captions')!;
        useEditorStore.getState().updateTrack(captions.id, { locked: true });
      });
      return STUB_WORDS;
    });
    const { showNotification } = renderControl();
    await user.click((await screen.findByRole('button', { name: 'Transcribe to captions' }))!);
    await waitFor(() =>
      expect(showNotification).toHaveBeenCalledWith('The Captions track is locked, so no captions were added.', 'error')
    );
    expect(captionClips()).toHaveLength(1);
  });

  it('says when the captions landed on a hidden Captions track', async () => {
    const user = userEvent.setup();
    installRecognition();
    available.mockResolvedValue('available');
    store().addCaptionCues([{ start: 9, end: 10, text: 'existing' }], { fontSize: 40 } as never);
    const captions = useEditorStore.getState().project.timeline.tracks.find((t) => t.kind === 'captions')!;
    store().updateTrack(captions.id, { visible: false });
    transcribeTimeline.mockResolvedValue([STUB_WORDS[0]]);
    const { showNotification } = renderControl();
    await user.click((await screen.findByRole('button', { name: 'Transcribe to captions' }))!);
    await waitFor(() =>
      expect(showNotification).toHaveBeenCalledWith(
        'Transcribed 1 caption onto the Captions track. The Captions track is hidden.',
        'success'
      )
    );
  });
});

describe('TranscribeControl: the project it was started in (ESCSUITE-432)', () => {
  const STOPPED = 'Transcription stopped. No captions were added.';

  /**
   * A transcription that resolves with `STUB_WORDS` only when told to, and
   * ignores its signal: the core finishing regardless, so the control alone
   * must keep the words out of a project they were not heard in.
   */
  function heldTranscription() {
    let finish!: () => void;
    const seen: { signal?: AbortSignal } = {};
    transcribeTimeline.mockImplementation(({ signal }) => {
      seen.signal = signal;
      return new Promise((resolve) => { finish = () => resolve(STUB_WORDS); });
    });
    return { finish: () => act(async () => finish()), seen };
  }

  async function startRun() {
    const user = userEvent.setup();
    installRecognition();
    available.mockResolvedValue('available');
    const held = heldTranscription();
    const view = renderControl();
    await user.click((await screen.findByRole('button', { name: 'Transcribe to captions' }))!);
    await screen.findByRole('button', { name: 'Stop transcribing' });
    return { ...held, ...view };
  }

  it('stops at once when New Project replaces the project, and adds nothing to the new one', async () => {
    const { finish, seen, showNotification } = await startRun();
    store().resetProject();
    const fresh = useEditorStore.getState().project;

    expect(seen.signal?.aborted).toBe(true);
    await waitFor(() => expect(showNotification).toHaveBeenCalledWith(STOPPED, 'info'));
    expect(button()).toBeEnabled();
    await finish();
    expect(captionClips()).toHaveLength(0);
    expect(useEditorStore.getState().project).toBe(fresh);
    expect(showNotification).not.toHaveBeenCalledWith(expect.stringMatching(/^Transcribed/), 'success');
  });

  it('stops when Open or a host LOAD_PROJECT puts another project in its place', async () => {
    const { finish, seen, showNotification } = await startRun();
    const other = { ...useEditorStore.getState().project, id: 'another-project' };
    store().setProject(other);

    expect(seen.signal?.aborted).toBe(true);
    await waitFor(() => expect(showNotification).toHaveBeenCalledWith(STOPPED, 'info'));
    await finish();
    expect(captionClips()).toHaveLength(0);
  });

  it('adds nothing even when the project changed the instant the words came back', async () => {
    const user = userEvent.setup();
    installRecognition();
    available.mockResolvedValue('available');
    // The swap and the answer in the same tick: no chance to abort first.
    transcribeTimeline.mockImplementation(async () => {
      useEditorStore.setState({ project: { ...useEditorStore.getState().project, id: 'swapped' } });
      return STUB_WORDS;
    });
    const { showNotification } = renderControl();
    await user.click((await screen.findByRole('button', { name: 'Transcribe to captions' }))!);
    await waitFor(() => expect(showNotification).toHaveBeenCalledWith(STOPPED, 'info'));
    expect(captionClips()).toHaveLength(0);
  });

  it('still finishes after ordinary edits to the same project: a rename, a track change, an undo', async () => {
    const { finish, seen, showNotification } = await startRun();
    const project = useEditorStore.getState().project;
    store().setProject({ ...project, name: 'Renamed', modified: Date.now() });
    store().addTrack('Extra');
    store().undo();

    expect(seen.signal?.aborted).toBe(false);
    await finish();
    expect(captionClips()).toHaveLength(2);
    expect(useEditorStore.getState().project.name).toBe('Renamed');
    expect(showNotification).toHaveBeenCalledWith('Transcribed 2 captions onto the Captions track.', 'success');
    expect(showNotification).not.toHaveBeenCalledWith(STOPPED, 'info');
  });
});

describe('TranscribeControl: one run at a time (ESCSUITE-404)', () => {
  it('starts one transcription however often it is pressed while the browser is asked', async () => {
    const user = userEvent.setup();
    installRecognition();
    let answer!: (value: string) => void;
    available.mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
    transcribeTimeline.mockImplementation(() => new Promise(() => {}));
    renderControl();
    const transcribeButton = await screen.findByRole('button', { name: 'Transcribe to captions' });
    await user.click(transcribeButton);
    await user.click(transcribeButton);
    await user.click(transcribeButton);
    await act(async () => answer('available'));
    await screen.findByRole('button', { name: 'Stop transcribing' });
    expect(available).toHaveBeenCalledTimes(1);
    expect(transcribeTimeline).toHaveBeenCalledTimes(1);
  });

  it('does not start listening once the editor has gone, when a pack finishes installing', async () => {
    const user = userEvent.setup();
    installRecognition();
    available.mockResolvedValue('downloadable');
    let finish!: (ok: boolean) => void;
    install.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const { unmount, showNotification } = renderControl();
    await user.click((await screen.findByRole('button', { name: 'Transcribe to captions' }))!);
    await user.click(screen.getByRole('button', { name: 'Download language pack' }));
    unmount();
    await act(async () => finish(true));
    expect(transcribeTimeline).not.toHaveBeenCalled();
    expect(showNotification).not.toHaveBeenCalled();
  });

  it('gives focus back to its button when a pack finishes installing and listening starts', async () => {
    const user = userEvent.setup();
    installRecognition();
    available.mockResolvedValue('downloadable');
    let finish!: (ok: boolean) => void;
    install.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    transcribeTimeline.mockImplementation(() => new Promise(() => {}));
    renderControl();
    await user.click((await screen.findByRole('button', { name: 'Transcribe to captions' }))!);
    await user.click(screen.getByRole('button', { name: 'Download language pack' }));
    await act(async () => finish(true));
    expect(await screen.findByRole('button', { name: 'Stop transcribing' })).toHaveFocus();
  });

  it('leaves focus alone once the user has moved it elsewhere', async () => {
    const user = userEvent.setup();
    installRecognition();
    available.mockResolvedValue('available');
    let done!: (cues: CaptionCue[] | null) => void;
    transcribeTimeline.mockImplementation(() => new Promise((resolve) => { done = resolve; }));
    renderControl();
    await user.click((await screen.findByRole('button', { name: 'Transcribe to captions' }))!);
    await screen.findByRole('button', { name: 'Stop transcribing' });
    // A click on nothing in particular leaves focus on the page itself.
    await user.click(document.body);
    expect(document.body).toHaveFocus();
    await act(async () => done(null));
    expect(document.body).toHaveFocus();
  });
});

describe('TranscribeControl: the language pack (ESCSUITE-404)', () => {
  it('says what will be downloaded before anything is, and downloads only when asked', async () => {
    const user = userEvent.setup();
    installRecognition();
    available.mockResolvedValue('downloadable');
    install.mockResolvedValue(true);
    transcribeTimeline.mockResolvedValue(STUB_WORDS);
    renderControl();

    await user.click((await screen.findByRole('button', { name: 'Transcribe to captions' }))!);
    expect(screen.getByText(LANGUAGE_PACK_NOTICE)).toBeInTheDocument();
    expect(LANGUAGE_PACK_NOTICE).toBe(
      'Your browser will download a speech language pack once. Your audio never leaves this device.'
    );
    expect(install).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Download language pack' })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Download language pack' }));
    expect(install).toHaveBeenCalledWith({ langs: [navigator.language], processLocally: true });
    await waitFor(() => expect(captionClips()).toHaveLength(2));
  });

  it('downloads nothing when the notice is cancelled', async () => {
    const user = userEvent.setup();
    installRecognition();
    available.mockResolvedValue('downloadable');
    renderControl();
    await user.click((await screen.findByRole('button', { name: 'Transcribe to captions' }))!);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText(LANGUAGE_PACK_NOTICE)).not.toBeInTheDocument();
    expect(button()).toHaveFocus();
    expect(install).not.toHaveBeenCalled();
    expect(transcribeTimeline).not.toHaveBeenCalled();
  });

  it('waits on a download the browser already started, and says when an install fails', async () => {
    const user = userEvent.setup();
    installRecognition();
    available.mockResolvedValue('downloading');
    let finish!: (ok: boolean) => void;
    install.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const { showNotification } = renderControl();
    await user.click((await screen.findByRole('button', { name: 'Transcribe to captions' }))!);
    expect(screen.getByText('Downloading the speech language pack…')).toHaveAttribute('aria-live', 'polite');
    await act(async () => finish(false));
    expect(showNotification).toHaveBeenCalledWith('The speech language pack could not be installed.', 'error');
    expect(transcribeTimeline).not.toHaveBeenCalled();
  });

  it('asks again on every press, and hides itself when the browser has since become unable to transcribe', async () => {
    const user = userEvent.setup();
    installRecognition();
    available.mockResolvedValueOnce('available').mockResolvedValueOnce('unavailable');
    transcribeTimeline.mockResolvedValue([]);
    const { showNotification } = renderControl();
    await user.click(screen.getByRole('button', { name: 'Transcribe to captions' }));
    await waitFor(() => expect(showNotification).toHaveBeenCalledWith('No speech was heard, so no captions were added.', 'info'));
    await user.click(button()!);
    expect(available).toHaveBeenCalledTimes(2);
    expect(showNotification).toHaveBeenCalledWith('On-device speech recognition is not available in this browser.', 'info');
    expect(button()).toBeNull();
  });
});
