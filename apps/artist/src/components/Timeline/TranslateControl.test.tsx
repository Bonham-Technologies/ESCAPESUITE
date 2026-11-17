// ESCSUITE-473: "Translate captions" in the timeline's controls. It exists
// only where the browser has the Translator API, asks nothing until pressed,
// asks before a translation model is downloaded, confirms an unknown source
// language with the user, and lands the translation as a second caption track
// in one undo step, every cue at its source cue's exact times.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TranslateControl } from './TranslateControl';
import { TRANSLATION_LANGUAGE_KEY, translationModelNotice } from '../../core/translationLanguage';
import { useEditorStore } from '../../store/projectStore';
import { resetStoreForTest, store } from '../../test/fixtures/projectStore';
import { captionStyleFor, type CaptionCue } from '../../core/captions';
import type { CreateMonitorLike } from '../../core/translatorLocal';

const availability = vi.fn<(options: unknown) => Promise<string>>();
const created: Array<Record<string, unknown>> = [];
const translate = vi.fn<(text: string, options?: { signal?: AbortSignal }) => Promise<string>>();
const destroy = vi.fn();
let progress: number[] = [];
let createGate: Promise<void> | null = null;

function installTranslator() {
  const Translator = {
    availability,
    create: vi.fn(async (options: Record<string, unknown> & { monitor?: (m: CreateMonitorLike) => void }) => {
      created.push(options);
      const listeners: Array<(event: { loaded: number }) => void> = [];
      options.monitor?.({ addEventListener: (_type, listener) => listeners.push(listener) });
      for (const loaded of progress) for (const listener of listeners) listener({ loaded });
      if (createGate) await createGate;
      return { translate, destroy };
    }),
  };
  vi.stubGlobal('Translator', Translator);
  return Translator;
}

const detectorAvailability = vi.fn<() => Promise<string>>();
const detect = vi.fn<(text: string) => Promise<Array<{ detectedLanguage: string; confidence: number }>>>();
const detectorCreate = vi.fn(async () => ({ detect, destroy: vi.fn() }));
function installDetector() {
  vi.stubGlobal('LanguageDetector', { availability: detectorAvailability, create: detectorCreate });
}

const SPANISH: Record<string, string> = {
  'Hello there.': 'Hola.',
  'Two lines of text.': 'Dos líneas de texto.',
};

const CUES: CaptionCue[] = [
  { start: 1.234567, end: 2.5, text: 'Hello there.' },
  { start: 3, end: 4.000001, text: 'Two lines\nof text.' },
];

function addCaptions(language?: string) {
  return store().addCaptionCues(CUES, captionStyleFor({ width: 1920, height: 1080 }), language ? { language } : undefined)!;
}

function renderControl() {
  const showNotification = vi.fn();
  const view = render(<TranslateControl showNotification={showNotification} />);
  return { showNotification, ...view };
}

const button = () => screen.queryByRole('button', { name: 'Translate captions' });
const captionTracks = () => useEditorStore.getState().project.timeline.tracks.filter((t) => t.kind === 'captions');
const clipsOn = (trackId: string) =>
  useEditorStore
    .getState()
    .project.timeline.clips.filter((c) => c.trackId === trackId)
    .sort((a, b) => a.timelinePosition - b.timelinePosition);

beforeEach(() => {
  resetStoreForTest();
  localStorage.clear();
  availability.mockReset();
  translate.mockReset();
  translate.mockImplementation(async (text) => SPANISH[text] ?? `[es] ${text}`);
  destroy.mockReset();
  detectorAvailability.mockReset();
  detect.mockReset();
  detectorCreate.mockClear();
  created.length = 0;
  progress = [];
  createGate = null;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TranslateControl: where it is offered (ESCSUITE-473)', () => {
  it('renders nothing, and calls nothing, where the browser has no Translator API', async () => {
    vi.stubGlobal('Translator', undefined);
    Reflect.deleteProperty(globalThis, 'Translator');
    installDetector();
    addCaptions('en-US');
    const { container } = renderControl();
    await act(async () => {});
    expect(container).toBeEmptyDOMElement();
    expect(detectorAvailability).not.toHaveBeenCalled();
  });

  it('renders nothing for a Translator without availability() and create()', async () => {
    vi.stubGlobal('Translator', {});
    const { container } = renderControl();
    await act(async () => {});
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing in a bare Chromium embedder, even with the API', async () => {
    installTranslator();
    vi.stubGlobal('navigator', {
      ...navigator,
      language: navigator.language,
      userAgentData: { brands: [{ brand: 'Chromium', version: '139' }] },
    });
    const { container } = renderControl();
    await act(async () => {});
    expect(container).toBeEmptyDOMElement();
  });

  it('is offered on static detection alone, and asks the browser nothing until pressed', async () => {
    const Translator = installTranslator();
    installDetector();
    addCaptions();
    renderControl();
    expect(button()).toBeEnabled();
    await act(async () => {});
    expect(availability).not.toHaveBeenCalled();
    expect(Translator.create).not.toHaveBeenCalled();
    expect(detectorAvailability).not.toHaveBeenCalled();
  });
});

describe('TranslateControl: translating (ESCSUITE-473)', () => {
  it('says so, asking nothing, when there are no captions', async () => {
    const user = userEvent.setup();
    installTranslator();
    const { showNotification } = renderControl();
    await user.click(button()!);
    expect(showNotification).toHaveBeenCalledWith('There are no captions to translate.', 'info');
    expect(availability).not.toHaveBeenCalled();
  });

  it('translates a track of known language into a second caption track, times exact, in one undo step', async () => {
    const user = userEvent.setup();
    installTranslator();
    availability.mockResolvedValue('available');
    const { trackId } = addCaptions('en-US');
    useEditorStore.setState({ history: { past: [], future: [] } });
    const source = clipsOn(trackId);
    const { showNotification } = renderControl();

    await user.click(button()!);
    await waitFor(() =>
      expect(showNotification).toHaveBeenCalledWith('Translated 2 captions into Spanish on a new caption track.', 'success')
    );
    // The Translator API is asked for the language alone (en-US → en), and the cues one line each.
    expect(availability).toHaveBeenCalledWith({ sourceLanguage: 'en', targetLanguage: 'es' });
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ sourceLanguage: 'en', targetLanguage: 'es' });
    expect(translate.mock.calls.map(([text]) => text)).toEqual(['Hello there.', 'Two lines of text.']);
    expect(destroy).toHaveBeenCalled();

    const [, spanish] = captionTracks();
    expect(spanish).toMatchObject({ language: 'es', name: 'Captions (Spanish)', kind: 'captions' });
    const added = clipsOn(spanish.id);
    expect(added.map((c) => c.textData!.text)).toEqual(['Hola.', 'Dos líneas de texto.']);
    expect(added.map((c) => [c.timelinePosition, c.timelinePosition + c.duration])).toEqual(
      source.map((c) => [c.timelinePosition, c.timelinePosition + c.duration])
    );
    // The track's language was known, so it is left as it was.
    expect(captionTracks()[0].language).toBe('en-US');

    expect(useEditorStore.getState().history.past).toHaveLength(1);
    act(() => store().undo());
    expect(captionTracks()).toHaveLength(1);
    expect(clipsOn(trackId)).toEqual(source);
  });

  it('shows the notice before a model is downloaded, downloads nothing on Cancel, and only on the confirm', async () => {
    const user = userEvent.setup();
    const Translator = installTranslator();
    availability.mockResolvedValue('downloadable');
    progress = [0, 0.5, 1];
    addCaptions('en-US');
    const { showNotification } = renderControl();

    await user.click(button()!);
    const notice = translationModelNotice('en', 'es');
    expect(notice).toBe('Your browser will download a translation model for English to Spanish once. Your captions never leave this device.');
    expect(await screen.findByText(notice)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Download translation model' })).toHaveFocus();
    expect(Translator.create).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText(notice)).toBeNull();
    expect(Translator.create).not.toHaveBeenCalled();
    expect(captionTracks()).toHaveLength(1);

    await user.click(button()!);
    await user.click(await screen.findByRole('button', { name: 'Download translation model' }));
    await waitFor(() => expect(captionTracks()).toHaveLength(2));
    expect(Translator.create).toHaveBeenCalledTimes(1);
    expect(typeof created[0].monitor).toBe('function');
    expect(showNotification).toHaveBeenCalledWith('Translated 2 captions into Spanish on a new caption track.', 'success');
  });

  it('reports the download as it goes, and Stop adds nothing', async () => {
    const user = userEvent.setup();
    installTranslator();
    availability.mockResolvedValue('downloading');
    progress = [0.42];
    let release!: () => void;
    createGate = new Promise((resolve) => (release = resolve));
    addCaptions('en-US');
    const { showNotification } = renderControl();

    await user.click(button()!);
    expect(await screen.findByText('Downloading the translation model…')).toBeVisible();
    expect(screen.getByText('42%')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Stop translating' }));
    await waitFor(() => expect(showNotification).toHaveBeenCalledWith('Translation stopped. No captions were added.', 'info'));
    release();
    await act(async () => {});
    expect(captionTracks()).toHaveLength(1);
    expect(button()).toBeEnabled();
  });

  it('stops, adding nothing, when another project takes the open one’s place', async () => {
    const user = userEvent.setup();
    installTranslator();
    availability.mockResolvedValue('available');
    let release!: () => void;
    translate.mockImplementationOnce(() => new Promise((resolve) => (release = () => resolve('Hola.'))));
    addCaptions('en-US');
    const { showNotification } = renderControl();
    await user.click(button()!);
    await waitFor(() => expect(translate).toHaveBeenCalled());
    act(() => store().resetProject());
    await waitFor(() => expect(showNotification).toHaveBeenCalledWith('Translation stopped. No captions were added.', 'info'));
    release();
    await act(async () => {});
    expect(captionTracks()).toHaveLength(0);
  });

  it('closes the download notice, downloading nothing, when another project takes the open one’s place', async () => {
    const user = userEvent.setup();
    const Translator = installTranslator();
    availability.mockResolvedValue('downloadable');
    addCaptions('en-US');
    renderControl();
    await user.click(button()!);
    const notice = translationModelNotice('en', 'es');
    expect(await screen.findByText(notice)).toBeVisible();
    act(() => store().resetProject());
    expect(screen.queryByText(notice)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Download translation model' })).toBeNull();
    expect(Translator.create).not.toHaveBeenCalled();
    expect(button()).toBeEnabled();
  });

  it('asks the translator for nothing more when the project is replaced while availability() is answering', async () => {
    const user = userEvent.setup();
    const Translator = installTranslator();
    let answer!: (value: string) => void;
    availability.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    addCaptions('en-US');
    const { showNotification } = renderControl();
    await user.click(button()!);
    await waitFor(() => expect(availability).toHaveBeenCalled());
    act(() => store().resetProject());
    await act(async () => answer('downloadable'));
    expect(showNotification).toHaveBeenCalledWith('Translation stopped. No captions were added.', 'info');
    expect(screen.queryByRole('button', { name: 'Download translation model' })).toBeNull();
    expect(Translator.create).not.toHaveBeenCalled();
  });

  it('says a pair is not available, and stays for another', async () => {
    const user = userEvent.setup();
    installTranslator();
    availability.mockResolvedValue('unavailable');
    addCaptions('en-US');
    const { showNotification } = renderControl();
    await user.click(button()!);
    await waitFor(() =>
      expect(showNotification).toHaveBeenCalledWith('Translating English to Spanish is not available in this browser.', 'info')
    );
    expect(button()).toBeEnabled();
  });

  it('treats a failing availability() as unavailable', async () => {
    const user = userEvent.setup();
    installTranslator();
    availability.mockRejectedValue(new DOMException('blocked', 'NotAllowedError'));
    addCaptions('en-US');
    const { showNotification } = renderControl();
    await user.click(button()!);
    await waitFor(() => expect(showNotification).toHaveBeenCalledWith(expect.stringMatching(/is not available/), 'info'));
  });

  it('refuses a target the captions are already in, or that already has a track, asking nothing', async () => {
    const user = userEvent.setup();
    installTranslator();
    addCaptions('es-ES');
    const { showNotification } = renderControl();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Translation language' }), 'es');
    await user.click(button()!);
    expect(showNotification).toHaveBeenCalledWith('The captions are already in Spanish.', 'info');

    await user.selectOptions(screen.getByRole('combobox', { name: 'Translation language' }), 'en');
    availability.mockResolvedValue('available');
    await user.click(button()!);
    await waitFor(() => expect(captionTracks()).toHaveLength(2));
    await user.click(button()!);
    expect(showNotification).toHaveBeenLastCalledWith('This project already has a caption track in English.', 'info');
    expect(availability).toHaveBeenCalledTimes(1);
  });

  it('reports a translator that cannot be created, and one that fails mid-way', async () => {
    const user = userEvent.setup();
    const Translator = installTranslator();
    availability.mockResolvedValue('available');
    Translator.create.mockRejectedValueOnce(new Error('no'));
    addCaptions('en-US');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { showNotification } = renderControl();
    await user.click(button()!);
    await waitFor(() => expect(showNotification).toHaveBeenCalledWith('The browser could not start translating.', 'error'));
    translate.mockRejectedValueOnce(new Error('boom'));
    await user.click(button()!);
    await waitFor(() => expect(showNotification).toHaveBeenCalledWith('Could not translate the captions.', 'error'));
    expect(captionTracks()).toHaveLength(1);
  });

  it('reports a model download that fails', async () => {
    const user = userEvent.setup();
    const Translator = installTranslator();
    availability.mockResolvedValue('downloading');
    Translator.create.mockRejectedValueOnce(new Error('offline'));
    addCaptions('en-US');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { showNotification } = renderControl();
    await user.click(button()!);
    await waitFor(() => expect(showNotification).toHaveBeenCalledWith('The translation model could not be downloaded.', 'error'));
  });

  it('remembers the target language', async () => {
    const user = userEvent.setup();
    installTranslator();
    const { unmount } = renderControl();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Translation language' }), 'ja');
    expect(localStorage.getItem(TRANSLATION_LANGUAGE_KEY)).toBe('ja');
    unmount();
    renderControl();
    expect(screen.getByRole('combobox', { name: 'Translation language' })).toHaveValue('ja');
  });
});

describe('TranslateControl: an unknown source language (ESCSUITE-473)', () => {
  it('suggests the detector’s answer, asks the user, and writes the confirmed language to the source track', async () => {
    const user = userEvent.setup();
    installTranslator();
    installDetector();
    detectorAvailability.mockResolvedValue('available');
    detect.mockResolvedValue([{ detectedLanguage: 'fr', confidence: 0.9 }]);
    availability.mockResolvedValue('available');
    const { trackId } = addCaptions();
    renderControl();

    await user.click(button()!);
    expect(await screen.findByText('These captions look like French. Is that the language they are in?')).toBeVisible();
    const select = screen.getByRole('combobox', { name: 'Captions language' });
    expect(select).toHaveValue('fr');
    expect(select).toHaveFocus();
    expect(availability).not.toHaveBeenCalled();
    expect(detect).toHaveBeenCalledWith('Hello there. Two lines of text.', undefined);

    await user.selectOptions(select, 'en');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(captionTracks()).toHaveLength(2));
    expect(availability).toHaveBeenCalledWith({ sourceLanguage: 'en', targetLanguage: 'es' });
    expect(captionTracks().find((t) => t.id === trackId)!.language).toBe('en');
  });

  it('never makes the detector download a model: it asks with the browser’s language instead', async () => {
    const user = userEvent.setup();
    installTranslator();
    installDetector();
    detectorAvailability.mockResolvedValue('downloadable');
    addCaptions();
    renderControl();
    await user.click(button()!);
    expect(await screen.findByText('Which language are the captions in?')).toBeVisible();
    expect(detectorCreate).not.toHaveBeenCalled();
    expect(screen.getByRole('combobox', { name: 'Captions language' })).toHaveValue('en');
  });

  it('asks without a detector at all, and Cancel asks the translator nothing', async () => {
    const user = userEvent.setup();
    installTranslator();
    addCaptions();
    renderControl();
    await user.click(button()!);
    expect(await screen.findByText('Which language are the captions in?')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Which language are the captions in?')).toBeNull();
    expect(availability).not.toHaveBeenCalled();
    expect(captionTracks()[0].language).toBeUndefined();
  });
});
