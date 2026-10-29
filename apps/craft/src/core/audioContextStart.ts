/**
 * Starting a take's AudioContext without hanging the take (ESCSUITE-390).
 *
 * A context the browser cannot open an output device for stays `suspended`,
 * and its `resume()` never settles: Firefox on a machine with no sound server
 * does exactly that (the first cross-browser nightly, ESCSUITE-388, found it).
 * Both recorders used to await that promise while setting up a take, so Start
 * left CRAFT at 00:00 with a disabled Stop button, no notice and no way out
 * but a reload.
 *
 * Every take's audio, the mix as much as the microphone, runs through its
 * context, so a context that never starts is a take that cannot be recorded:
 * this fails it, with an error the controller turns into a notice naming the
 * audio, rather than recording a file with a silent or missing track.
 */

/**
 * How long a suspended context gets to start. A context that can start does
 * so in milliseconds; the deadline only has to be long enough not to fail a
 * slow device that is merely waking up.
 */
export const AUDIO_START_TIMEOUT_MS = 5_000;

/** The context never started: there is no audio output to run it on. */
export class AudioOutputUnavailableError extends Error {
  constructor() {
    super(`The AudioContext did not start within ${AUDIO_START_TIMEOUT_MS} ms`);
    this.name = 'AudioOutputUnavailableError';
  }
}

/**
 * Resume `context` if it is suspended, waiting at most `AUDIO_START_TIMEOUT_MS`.
 *
 * Resolves once `resume()` does, which the Web Audio spec makes the moment the
 * context runs, and rejects with `AudioOutputUnavailableError` when the
 * deadline passes first. A `resume()` rejection (a context closed by the take's
 * disposal, say) passes through unchanged, for the caller's disposal check.
 */
export async function startAudioContext(context: AudioContext): Promise<void> {
  if (context.state !== 'suspended') return;

  let giveUp: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<'timeout'>(resolve => {
    giveUp = setTimeout(() => resolve('timeout'), AUDIO_START_TIMEOUT_MS);
  });
  try {
    const outcome = await Promise.race([context.resume(), deadline]);
    if (outcome === 'timeout') throw new AudioOutputUnavailableError();
  } finally {
    clearTimeout(giveUp);
  }
}
