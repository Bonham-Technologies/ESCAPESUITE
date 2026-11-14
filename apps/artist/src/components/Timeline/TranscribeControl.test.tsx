// ESCSUITE-404: "Transcribe to captions" in the timeline's controls. It exists
// only where the browser can recognise speech on this device, asks before a
// language pack is downloaded, and lands its cues as caption clips in one
// undo step.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TranscribeControl } from './TranscribeControl';
import { TRANSCRIPTION_LANGUAGE_KEY, languagePackNotice } from '../../core/transcriptionLanguage';
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

// jsdom's own language, which the select starts on (ESCSUITE-444).
const LANGUAGE_PACK_NOTICE = languagePackNotice('English (United States)');

beforeEach(() => {
  resetStoreForTest();
  localStorage.clear();
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

  it('shows how much of the sound is prepared, outside the live region, and can be stopped then (ESCSUITE-438)', async () => {
    const user = userEvent.setup();
    installRecognition();
    available.mockResolvedValue('available');
    let report: ((percent: number) => void) | undefined;
    transcribeTimeline.mockImplementation(({ onProgress }) => {
      report = (percent) => onProgress?.('mixing', percent, 100);
      report(0);
      // A mix that never notices the stop: the button must not wait for it.
      return new Promise(() => {});
    });
    const { showNotification } = renderControl();
    await user.click((await screen.findByRole('button', { name: 'Transcribe to captions' }))!);
    expect(await screen.findByText('0%')).not.toHaveAttribute('aria-live');
    act(() => report!(42));
    expect(screen.getByText('42%')).not.toHaveAttribute('aria-live');
    expect(screen.getByText('Preparing the sound…')).toHaveAttribute('aria-live', 'polite');

    await user.click(screen.getByRole('button', { name: 'Stop transcribing' }));
    await waitFor(() => expect(showNotification).toHaveBeenCalledWith('Transcription stopped. No captions were added.', 'info'));
    expect(button()).toBeEnabled();
    expect(screen.queryByText(/%$/)).toBeNull();
    expect(captionClips()).toHaveLength(0);
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
    // Captions are already there, so it asks first (ESCSUITE-442).
    await user.click(screen.getByRole('button', { name: 'Add' }));
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

  it('mixes nothing new until a run stopped mid-mix has finished mixing, so two mixes never run at once', async () => {
    const { finish, showNotification } = await startRun();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Stop transcribing' }));
    await waitFor(() => expect(showNotification).toHaveBeenCalledWith(STOPPED, 'info'));

    // Pressed again while the stopped run's mix (which ignores its signal) runs on.
    transcribeTimeline.mockImplementation(async () => STUB_WORDS);
    await user.click(button()!);
    expect(await screen.findByText('Preparing the sound…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop transcribing' })).toBeEnabled();
    expect(transcribeTimeline).toHaveBeenCalledTimes(1);

    await finish();
    await waitFor(() => expect(transcribeTimeline).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(captionClips()).toHaveLength(2));
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
      'Your browser will download a speech language pack for English (United States) once. Your audio never leaves this device.'
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

// ESCSUITE-442: a second transcription used to stack a second copy of every
// caption on the track. With captions already there, a press asks first.
describe('TranscribeControl: captions already on the track (ESCSUITE-442)', () => {
  const QUESTION = 'Replace the existing captions, or add to them?';
  const EXISTING: CaptionCue[] = [
    { start: 0.7, end: 3, text: 'an earlier take' },
    { start: 4.7, end: 7, text: 'of the same words' },
  ];
  const dialog = () => screen.queryByRole('dialog', { name: QUESTION });

  function seedCaptions() {
    store().addCaptionCues(EXISTING, { fontSize: 40 } as never);
    useEditorStore.setState({ history: { past: [], future: [] } });
  }

  it('asks Replace, Add or Cancel before asking the browser anything', async () => {
    const user = userEvent.setup();
    installRecognition();
    available.mockResolvedValue('available');
    seedCaptions();
    const onDialogOpenChange = vi.fn();
    render(<TranscribeControl showNotification={vi.fn()} onDialogOpenChange={onDialogOpenChange} />);

    await user.click(button()!);

    const asked = dialog()!;
    expect(asked).toHaveAttribute('aria-modal', 'true');
    expect(asked).toHaveTextContent('The Captions track already has 2 captions.');
    const within = (name: string) => screen.getByRole('button', { name });
    // jsdom lays nothing out, so the hook parks focus on the dialog itself
    // rather than on Cancel; the e2e spec checks Cancel in a real browser.
    expect(asked).toContainElement(document.activeElement as HTMLElement);
    expect(within('Add')).toBeInTheDocument();
    expect(within('Replace')).toBeInTheDocument();
    expect(available).not.toHaveBeenCalled();
    expect(transcribeTimeline).not.toHaveBeenCalled();
    expect(onDialogOpenChange).toHaveBeenLastCalledWith(true);

    await user.click(within('Cancel'));
    expect(dialog()).toBeNull();
    expect(onDialogOpenChange).toHaveBeenLastCalledWith(false);
    expect(button()).toHaveFocus();
    expect(available).not.toHaveBeenCalled();
    expect(captionClips().map((c) => c.textData?.text)).toEqual(EXISTING.map((cue) => cue.text));
  });

  it('closes on Escape, as Cancel', async () => {
    const user = userEvent.setup();
    installRecognition();
    available.mockResolvedValue('available');
    seedCaptions();
    renderControl();

    await user.click(button()!);
    expect(dialog()).not.toBeNull();
    await user.keyboard('{Escape}');

    expect(dialog()).toBeNull();
    expect(available).not.toHaveBeenCalled();
  });

  it('Replace swaps the old captions for the new ones, and one undo brings the old ones back', async () => {
    const user = userEvent.setup();
    installRecognition();
    available.mockResolvedValue('available');
    transcribeTimeline.mockResolvedValue(STUB_WORDS);
    seedCaptions();
    const before = captionClips();
    const { showNotification } = renderControl();

    await user.click(button()!);
    await user.click(screen.getByRole('button', { name: 'Replace' }));

    await waitFor(() =>
      expect(showNotification).toHaveBeenCalledWith('Transcribed 2 captions onto the Captions track.', 'success')
    );
    expect(captionClips().map((c) => c.textData?.text)).toEqual(STUB_WORDS.map((cue) => cue.text));
    expect(useEditorStore.getState().history.past).toHaveLength(1);

    store().undo();
    expect(captionClips()).toEqual(before);
  });

  it('Add keeps the old captions and adds the new ones after them', async () => {
    const user = userEvent.setup();
    installRecognition();
    available.mockResolvedValue('available');
    transcribeTimeline.mockResolvedValue(STUB_WORDS);
    seedCaptions();
    const { showNotification } = renderControl();

    await user.click(button()!);
    await user.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() =>
      expect(showNotification).toHaveBeenCalledWith('Transcribed 2 captions onto the Captions track.', 'success')
    );
    expect(captionClips().map((c) => c.textData?.text)).toEqual([...EXISTING, ...STUB_WORDS].map((cue) => cue.text));
  });

  it('Replace survives the language-pack notice', async () => {
    const user = userEvent.setup();
    installRecognition();
    available.mockResolvedValue('downloadable');
    install.mockResolvedValue(true);
    transcribeTimeline.mockResolvedValue(STUB_WORDS);
    seedCaptions();
    renderControl();

    await user.click(button()!);
    await user.click(screen.getByRole('button', { name: 'Replace' }));
    await user.click(await screen.findByRole('button', { name: 'Download language pack' }));

    await waitFor(() => expect(captionClips().map((c) => c.textData?.text)).toEqual(STUB_WORDS.map((cue) => cue.text)));
  });

  it('Replace removes nothing when the new run hears no speech or fails', async () => {
    const user = userEvent.setup();
    installRecognition();
    available.mockResolvedValue('available');
    seedCaptions();
    const before = captionClips();
    const { showNotification } = renderControl();

    transcribeTimeline.mockResolvedValueOnce([]);
    await user.click(button()!);
    await user.click(screen.getByRole('button', { name: 'Replace' }));
    await waitFor(() =>
      expect(showNotification).toHaveBeenCalledWith('No speech was heard, so no captions were added.', 'info')
    );
    expect(captionClips()).toEqual(before);

    transcribeTimeline.mockRejectedValueOnce(new Error('boom'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    await user.click(button()!);
    await user.click(screen.getByRole('button', { name: 'Replace' }));
    await waitFor(() => expect(showNotification).toHaveBeenCalledWith('Could not transcribe the timeline.', 'error'));
    consoleError.mockRestore();
    expect(captionClips()).toEqual(before);
    expect(useEditorStore.getState().history.past).toHaveLength(0);
  });

  it('asks nothing when the only clip on the Captions track is not a caption', async () => {
    const user = userEvent.setup();
    installRecognition();
    available.mockResolvedValue('available');
    transcribeTimeline.mockResolvedValue(STUB_WORDS);
    seedCaptions();
    const [first, ...others] = captionClips();
    for (const clip of others) act(() => store().removeClipFromTimeline(clip.id));
    const { overlayType: _overlay, textData: _text, ...rest } = first;
    const timeline = useEditorStore.getState().project.timeline;
    useEditorStore.setState({
      project: {
        ...useEditorStore.getState().project,
        timeline: {
          ...timeline,
          clips: timeline.clips.map((clip) => (clip.id === first.id ? { ...rest, sourceVideoId: 'source-1' } : clip)),
        },
      },
    });
    renderControl();

    await user.click(button()!);

    expect(dialog()).toBeNull();
    await waitFor(() => expect(captionClips()).toHaveLength(1 + STUB_WORDS.length));
  });

  it('asks nothing when the Captions track is there but empty', async () => {
    const user = userEvent.setup();
    installRecognition();
    available.mockResolvedValue('available');
    transcribeTimeline.mockResolvedValue(STUB_WORDS);
    seedCaptions();
    for (const clip of captionClips()) act(() => store().removeClipFromTimeline(clip.id));
    renderControl();

    await user.click(button()!);

    expect(dialog()).toBeNull();
    await waitFor(() => expect(captionClips()).toHaveLength(2));
  });
});

// ESCSUITE-444: the spoken language used to be the browser's, always, so a
// recording in any other language could not be transcribed.
describe('TranscribeControl: the spoken language (ESCSUITE-444)', () => {
  const select = () => screen.getByRole('combobox', { name: 'Transcription language' });
  const optionValues = () =>
    Array.from((select() as HTMLSelectElement).options).map((option) => option.value);

  it("sits beside the button, starting on the browser's language, and asks the browser nothing on mount", async () => {
    installRecognition();
    available.mockResolvedValue('available');
    const { container } = renderControl();
    await act(async () => {});
    expect(select()).toHaveValue(navigator.language);
    expect(select()).toBeEnabled();
    expect(screen.getByRole('option', { name: 'English (United States)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Japanese (Japan)' })).toBeInTheDocument();
    // In the control's own row, just before the button.
    const row = container.firstElementChild!;
    expect(row).toContainElement(select());
    expect(select().compareDocumentPosition(button()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(available).not.toHaveBeenCalled();
    expect(install).not.toHaveBeenCalled();
  });

  it('is not rendered where the control is not', async () => {
    vi.stubGlobal('SpeechRecognition', undefined);
    vi.stubGlobal('webkitSpeechRecognition', undefined);
    renderControl();
    await act(async () => {});
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it("lists the browser's own language first when the list does not have it", async () => {
    installRecognition();
    vi.stubGlobal('navigator', { ...navigator, language: 'sv-SE' });
    renderControl();
    expect(select()).toHaveValue('sv-SE');
    expect(optionValues()[0]).toBe('sv-SE');
    expect(screen.getByRole('option', { name: 'Swedish (Sweden)' })).toBeInTheDocument();
    expect(optionValues()).toContain('en-US');
  });

  it('asks available() on the press for the chosen language only, and transcribes in it', async () => {
    const user = userEvent.setup();
    const Recognition = installRecognition();
    available.mockResolvedValue('available');
    transcribeTimeline.mockResolvedValue(STUB_WORDS);
    renderControl();
    await user.selectOptions(select(), 'de-DE');
    expect(available).not.toHaveBeenCalled();

    await user.click(button()!);
    expect(available).toHaveBeenCalledTimes(1);
    expect(available).toHaveBeenCalledWith({ langs: ['de-DE'], processLocally: true });
    await waitFor(() => expect(captionClips()).toHaveLength(2));
    expect(transcribeTimeline).toHaveBeenCalledWith(expect.objectContaining({ lang: 'de-DE', Recognition }));
  });

  it('is remembered for the next time the editor opens', async () => {
    const user = userEvent.setup();
    installRecognition();
    const first = renderControl();
    await user.selectOptions(select(), 'fr-FR');
    expect(localStorage.getItem(TRANSCRIPTION_LANGUAGE_KEY)).toBe('fr-FR');
    first.unmount();

    available.mockResolvedValue('unavailable');
    renderControl();
    expect(select()).toHaveValue('fr-FR');
    await user.click(button()!);
    expect(available).toHaveBeenCalledWith({ langs: ['fr-FR'], processLocally: true });
  });

  it('keeps a remembered language the list does not have', async () => {
    installRecognition();
    localStorage.setItem(TRANSCRIPTION_LANGUAGE_KEY, 'da-DK');
    renderControl();
    expect(select()).toHaveValue('da-DK');
    expect(screen.getByRole('option', { name: 'Danish (Denmark)' })).toBeInTheDocument();
  });

  it("starts on the browser's language when what is stored is not a language", async () => {
    installRecognition();
    localStorage.setItem(TRANSCRIPTION_LANGUAGE_KEY, '<not a tag>');
    renderControl();
    expect(select()).toHaveValue(navigator.language);
  });

  it('still works, unremembered, where storage is blocked', async () => {
    const user = userEvent.setup();
    installRecognition();
    available.mockResolvedValue('available');
    transcribeTimeline.mockResolvedValue([]);
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    try {
      const { showNotification } = renderControl();
      expect(select()).toHaveValue(navigator.language);
      await user.selectOptions(select(), 'it-IT');
      expect(select()).toHaveValue('it-IT');
      await user.click(button()!);
      expect(available).toHaveBeenCalledWith({ langs: ['it-IT'], processLocally: true });
      await waitFor(() => expect(showNotification).toHaveBeenCalledWith('No speech was heard, so no captions were added.', 'info'));
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('names the chosen language in the language-pack notice, and installs that one', async () => {
    const user = userEvent.setup();
    installRecognition();
    available.mockResolvedValue('downloadable');
    install.mockResolvedValue(true);
    transcribeTimeline.mockResolvedValue(STUB_WORDS);
    renderControl();
    await user.selectOptions(select(), 'ja-JP');
    await user.click(button()!);
    expect(
      screen.getByText(
        'Your browser will download a speech language pack for Japanese (Japan) once. Your audio never leaves this device.'
      )
    ).toBeInTheDocument();
    // Not changeable under the notice, so what it names is what is installed.
    expect(select()).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Download language pack' }));
    expect(install).toHaveBeenCalledWith({ langs: ['ja-JP'], processLocally: true });
    await waitFor(() => expect(captionClips()).toHaveLength(2));
    expect(transcribeTimeline).toHaveBeenCalledWith(expect.objectContaining({ lang: 'ja-JP' }));
  });

  it('cannot be changed while a run is going', async () => {
    const user = userEvent.setup();
    installRecognition();
    available.mockResolvedValue('available');
    transcribeTimeline.mockImplementation(() => new Promise(() => {}));
    renderControl();
    await user.click(button()!);
    await screen.findByRole('button', { name: 'Stop transcribing' });
    expect(select()).toBeDisabled();
  });

  it('cannot be changed while the browser is being asked, so the answer is for the language shown', async () => {
    const user = userEvent.setup();
    installRecognition();
    let answer!: (value: string) => void;
    available.mockImplementation(() => new Promise<string>((resolve) => (answer = resolve)));
    install.mockResolvedValue(true);
    transcribeTimeline.mockResolvedValue(STUB_WORDS);
    renderControl();
    await user.selectOptions(select(), 'fr-FR');
    await user.click(button()!);
    expect(available).toHaveBeenCalledWith({ langs: ['fr-FR'], processLocally: true });
    expect(select()).toBeDisabled();
    await act(async () => answer('downloadable'));
    expect(screen.getByText(languagePackNotice('French (France)'))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Download language pack' }));
    expect(install).toHaveBeenCalledWith({ langs: ['fr-FR'], processLocally: true });
    await waitFor(() => expect(captionClips()).toHaveLength(2));
    expect(select()).toBeEnabled();
  });

  it("stays, and says which language, when the browser's own language is one the list lacks and is unavailable", async () => {
    // A Swedish browser with no Swedish pack can still transcribe English,
    // so "not available in this browser" and hiding the control would be wrong.
    const user = userEvent.setup();
    installRecognition();
    vi.stubGlobal('navigator', { ...navigator, language: 'sv-SE' });
    available.mockResolvedValue('unavailable');
    const { showNotification } = renderControl();
    await user.click(button()!);
    expect(available).toHaveBeenCalledWith({ langs: ['sv-SE'], processLocally: true });
    expect(showNotification).toHaveBeenCalledWith(
      'On-device speech recognition is not available for Swedish (Sweden) in this browser.',
      'info'
    );
    expect(button()).toBeEnabled();
    expect(select()).toBeEnabled();
  });

  it('stays, and says which language, when another language than the browser’s is unavailable', async () => {
    const user = userEvent.setup();
    installRecognition();
    available.mockResolvedValueOnce('unavailable').mockResolvedValueOnce('available');
    transcribeTimeline.mockResolvedValue([]);
    const { showNotification } = renderControl();
    await user.selectOptions(select(), 'hi-IN');
    await user.click(button()!);
    expect(showNotification).toHaveBeenCalledWith(
      'On-device speech recognition is not available for Hindi (India) in this browser.',
      'info'
    );
    expect(button()).toBeEnabled();
    expect(select()).toBeEnabled();

    await user.selectOptions(select(), 'en-US');
    await user.click(button()!);
    expect(available).toHaveBeenLastCalledWith({ langs: ['en-US'], processLocally: true });
    await waitFor(() => expect(showNotification).toHaveBeenCalledWith('No speech was heard, so no captions were added.', 'info'));
  });
});
