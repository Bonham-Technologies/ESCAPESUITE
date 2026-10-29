import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  AUDIO_START_TIMEOUT_MS,
  AudioOutputUnavailableError,
  startAudioContext,
} from './audioContextStart';

/** Just enough of an AudioContext for `startAudioContext`. */
function fakeContext(initial: AudioContextState, resume: () => Promise<void>) {
  const context = { state: initial as AudioContextState | 'interrupted', resume: vi.fn() };
  context.resume.mockImplementation(async () => {
    await resume();
    if (context.state === 'suspended') context.state = 'running';
  });
  return context as unknown as AudioContext & { state: AudioContextState };
}

const never = () => new Promise<void>(() => {});

describe('startAudioContext (ESCSUITE-390)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('leaves a running context alone', async () => {
    const context = fakeContext('running', async () => {});
    await expect(startAudioContext(context)).resolves.toBeUndefined();
    expect(context.resume).not.toHaveBeenCalled();
  });

  it('resumes a suspended context that starts', async () => {
    const context = fakeContext('suspended', async () => {});
    await expect(startAudioContext(context)).resolves.toBeUndefined();
    expect(context.resume).toHaveBeenCalledTimes(1);
    expect(context.state).toBe('running');
  });

  it('gives up on a resume() that never settles, after the deadline', async () => {
    vi.useFakeTimers();
    const context = fakeContext('suspended', never);
    const started = startAudioContext(context);
    const outcome = started.then(
      () => 'resolved',
      (e: unknown) => e
    );

    await vi.advanceTimersByTimeAsync(AUDIO_START_TIMEOUT_MS - 1);
    // Still waiting one millisecond before the deadline.
    expect(await Promise.race([outcome, Promise.resolve('pending')])).toBe('pending');

    await vi.advanceTimersByTimeAsync(1);
    const error = await outcome;
    expect(error).toBeInstanceOf(AudioOutputUnavailableError);
    expect((error as Error).name).toBe('AudioOutputUnavailableError');
  });

  it('passes a resume() rejection through', async () => {
    const boom = new DOMException('closed', 'InvalidStateError');
    const context = fakeContext('suspended', () => Promise.reject(boom));
    await expect(startAudioContext(context)).rejects.toBe(boom);
  });

  it('clears its timer however the wait ends', async () => {
    vi.useFakeTimers();
    const context = fakeContext('suspended', async () => {});
    await startAudioContext(context);
    expect(vi.getTimerCount()).toBe(0);
  });
});
