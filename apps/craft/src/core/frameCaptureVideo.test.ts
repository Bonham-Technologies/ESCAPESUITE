import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  FRAME_CAPTURE_START_TIMEOUT_MS,
  FrameCaptureUnavailableError,
  openFrameCaptureVideo,
  releaseFrameCaptureVideo,
} from './frameCaptureVideo';

const track = { id: 'screen-video', kind: 'video' } as MediaStreamTrack;
const never = () => new Promise<void>(() => {});

/** A `<video>` already on the page, as CRAFT's preview is, showing `shown`. */
function pagePreview(shown: MediaStreamTrack, { playing = true } = {}): HTMLVideoElement {
  const preview = document.createElement('video');
  preview.srcObject = new MediaStream([shown]);
  Object.defineProperty(preview, 'paused', { value: !playing });
  Object.defineProperty(preview, 'readyState', { value: playing ? HTMLMediaElement.HAVE_ENOUGH_DATA : 0 });
  document.body.appendChild(preview);
  return preview;
}

/** Stub every element's play(); the preview's is never called. */
function stubPlay(play: () => Promise<void>) {
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  return vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(play);
}

describe('openFrameCaptureVideo (ESCSUITE-398)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('uses its own element when that one plays, laid out on screen rather than hidden', async () => {
    stubPlay(async () => {});
    const onOwn = vi.fn();
    const capture = await openFrameCaptureVideo(track, 1920, 1080, onOwn);

    expect(capture.owned).toBe(true);
    expect(onOwn).toHaveBeenCalledWith(capture);
    expect(capture.element.isConnected).toBe(true);
    expect((capture.element.srcObject as MediaStream).getVideoTracks()).toEqual([track]);
    expect(capture.element.muted).toBe(true);
    // WebKit never plays a MediaStream into an element that is not rendered.
    expect(capture.element.style.visibility).not.toBe('hidden');
    expect(capture.element.style.opacity).toBe('0');
    expect(capture.element.style.width).toBe('1920px');
  });

  it('borrows a playing element showing the same track when its own never starts', async () => {
    vi.useFakeTimers();
    stubPlay(never);
    const preview = pagePreview(track);
    const onOwn = vi.fn();
    const opened = openFrameCaptureVideo(track, 1280, 720, onOwn);

    await vi.advanceTimersByTimeAsync(FRAME_CAPTURE_START_TIMEOUT_MS);
    const capture = await opened;

    expect(capture).toEqual({ element: preview, owned: false });
    // Its own element was taken down, and was the only one it reported.
    const own = onOwn.mock.calls[0][0].element as HTMLVideoElement;
    expect(own.isConnected).toBe(false);
    expect(own.srcObject).toBeNull();
    expect(onOwn).toHaveBeenCalledTimes(1);
  });

  it('matches the preview by track id, so a clone of the track counts', async () => {
    vi.useFakeTimers();
    stubPlay(never);
    const preview = pagePreview({ id: track.id, kind: 'video' } as MediaStreamTrack);
    const opened = openFrameCaptureVideo(track, 1280, 720);
    await vi.advanceTimersByTimeAsync(FRAME_CAPTURE_START_TIMEOUT_MS);
    expect((await opened).element).toBe(preview);
  });

  it('fails with FrameCaptureUnavailableError when nothing on the page is playing the track', async () => {
    vi.useFakeTimers();
    stubPlay(never);
    pagePreview(track, { playing: false });
    pagePreview({ id: 'webcam-video', kind: 'video' } as MediaStreamTrack);
    document.body.appendChild(document.createElement('video')); // a file player, no stream
    const opened = openFrameCaptureVideo(track, 1280, 720).catch((e: unknown) => e);

    await vi.advanceTimersByTimeAsync(FRAME_CAPTURE_START_TIMEOUT_MS - 1);
    expect(await Promise.race([opened, Promise.resolve('pending')])).toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    expect(await opened).toBeInstanceOf(FrameCaptureUnavailableError);
  });

  it('passes a play() rejection through, for the recorder’s disposal check', async () => {
    const aborted = new DOMException('The play() request was interrupted', 'AbortError');
    stubPlay(() => Promise.reject(aborted));
    await expect(openFrameCaptureVideo(track, 1280, 720)).rejects.toBe(aborted);
  });
});

describe('releaseFrameCaptureVideo', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('takes down an element the take built', () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    const element = document.createElement('video');
    element.srcObject = new MediaStream([track]);
    document.body.appendChild(element);

    releaseFrameCaptureVideo({ element, owned: true });

    expect(pause).toHaveBeenCalledTimes(1);
    expect(element.srcObject).toBeNull();
    expect(element.isConnected).toBe(false);
  });

  it('never touches a borrowed preview', () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    const preview = pagePreview(track);
    const shown = preview.srcObject;

    releaseFrameCaptureVideo({ element: preview, owned: false });

    expect(pause).not.toHaveBeenCalled();
    expect(preview.srcObject).toBe(shown);
    expect(preview.isConnected).toBe(true);
  });
});
