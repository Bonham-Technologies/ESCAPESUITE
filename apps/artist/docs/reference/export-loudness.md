<!-- Moved verbatim from apps/artist/CLAUDE.md on 2026-10-19. Edit here; CLAUDE.md only indexes this file. -->
# Export Loudness (`src/core/loudness.ts`) (ESCSUITE-292)

Every MP4 and WebM export measures its mix — ITU-R BS.1770-4 integrated loudness and true
peak, read the EBU R128 way — and, when the export dialog's **Audio loudness** choice names a
target, normalises it onto that target under a **−1 dBTP** true-peak limiter. GIF has no sound
and measures nothing.

- **Where it runs.** One awaited call, `exportLoudness(audioData, channels, sampleRate, target, { signal, onProgress })`, after
  `extractAndMixAudio` has mixed the exported range (ESCSUITE-367: it mixes only the range, where
  the exporters used to slice a whole-timeline mix), and
  before the encoder is fed: in `exportMP4.ts` right after the mix (the AAC probe has already
  run, so a browser with no AAC encoder has no mix and measures nothing); in `exportWebM.ts`
  right after the Opus probe (so a WebM that cannot carry sound is not measured either). It
  measures the **exported range**, not the whole timeline. One pass over the mix — nothing per
  video frame; the export and preview `*.perf.test.ts` ceilings are untouched.
- **Cooperative (ESCSUITE-301).** That pass used to be one synchronous call — about 2 s of
  measurement and 3.4 s with the limiter on a 10-minute mix, with the main thread blocked, the
  dialog's Cancel dead and its live region silent. It is now `await`ed and walked in slices of
  `loudnessSliceFrames(sampleRate)` = 2 s of audio (`LOUDNESS_SLICE_SECONDS`): after each slice
  it reports progress, then yields through the exporters' own MessageChannel `yieldToMain`
  (`LoudnessPacing.sleep` is the test seam), then checks the export's `AbortSignal` — and once
  more before the first slice, and at the boundary between the measurement and the limiter. Not a
  `setTimeout(…, 0)`: a timer chain is clamped to 4 ms in a visible tab and to once a second (once
  a minute after five minutes) in a hidden one, which would add minutes to a long mix in a
  background tab. It
  is **not** a Worker: a transferred copy of a 10-minute mix is ~230 MB, and the yields are
  enough. The meter and the limiter are generators (`meterSteps`, `limiterSteps`) that carry
  every piece of state across a boundary — the biquads, the half-filled 100 ms sub-block, the
  window bound, the limiter's envelope, hold and delay line — and the synchronous
  `measureLoudness` / `applyGainWithLimiter` are the same generators run with no yield, so the
  sliced pass is **bit-identical** (`loudness.test.ts` compares with `Object.is` on every
  ESCSUITE-292 fixture and with boundaries on a 100 ms hop, inside one, inside a 400 ms block and
  every 23 samples). Progress reaches the dialog through the exporters' own `onProgress` as
  `{ phase: 'measuring-loudness', message: 'Measuring loudness…' }` — one report per slice and a
  final one, at 10 → 12 in MP4 (between the extraction and the media load) and 15 → 17 in WebM
  (after "Initializing encoder…", where the Opus probe puts the call, before the first encoder),
  through the ESCSUITE-215 throttle and the one live region — the visible line and the bar follow
  every report, but the measurement sits inside the extraction's ten-point band, so the region
  speaks it only on the throttle's 5 s floor, which a mix of roughly 15 minutes or more reaches;
  the phase reads "Measuring loudness" (`PHASE_LABELS`); with a target the measurement takes
  the first half and the limiter, if it runs, the second. Cancel rejects with
  `ExportAbortedError` at the next boundary (at most one slice later): in MP4 before any media is
  loaded, in WebM into the catch that releases the loaded media, with no encoder built in either.
  An abort inside the limiter leaves the mix partly gained, which is harmless — the export is
  abandoned and nothing reads that buffer again.
- **The meter.** K-weighting is two biquads (high shelf, RLB high-pass) derived for any rate by
  the bilinear transform; at 48 kHz they reproduce BS.1770-4's printed table to eight decimals
  (`loudness.test.ts` checks the table). Mean square per channel over 400 ms blocks stepped
  every 100 ms, channel weights L/R/C 1.0, surrounds 1.41, LFE 0; the −70 LUFS absolute gate
  then the −10 LU relative gate; integrated = −0.691 + 10·log10(gated mean). A trailing partial
  block is dropped. **True peak** is a 4× read through a 24-tap-per-phase Hann-windowed sinc;
  it agrees with ffmpeg's `ebur128` on full-band white noise (both read ~0.7 dB under a 128-tap
  reference there, so content right at Nyquist can pass the ceiling by that much). The 72
  multiply-adds per sample are skipped wherever a cheap window bound proves they cannot change
  the answer, which brings a minute of speech-like stereo to ~0.2 s (a steady tone, where nothing
  can be skipped, ~0.5 s). The mix is read in place (planar from the exporters since ESCSUITE-367; an interleaved
  one through a stride), never copied apart; the only allocations are one number per 100 ms of programme and the limiter's
  fourteen-slot gain delay line. Filter state is kept out of subnormal numbers by a −400 dB offset,
  which an x86 CPU otherwise processes an order of magnitude slower through every silent gap.
- **Normalising.** `gainForTarget` is `target − measured`, **capped at `MAX_GAIN_DB` = +20 dB of
  boost** — a mix that only just clears the −70 LUFS gate (room tone, hum) would otherwise be
  raised 50 dB or more with its noise floor; capped, it lands below the target and the completion
  line shows the gain actually applied — and says whether the gained true peak would pass the
  ceiling, judged on that capped gain. When it would not, the gain is a plain multiply (the limiter's detector
  reads exactly the peaks the meter measured, so it could never engage). When it would,
  `applyInterleavedGainWithLimiter` runs: **stereo-linked, instant attack, 5 ms hold, 50 ms
  release, no look-ahead** beyond the interpolator's own twelve samples, its detector the meter's
  4× peak around each sample. Sample peaks are held exactly; the true peak to within about
  0.1 dB on the fixtures. **A limited mix lands below the target** — well below it when short peaks
  carry the loudness (a click-dominated programme asked for +8.7 dB measured 8.6 LU short), because
  `gainDb` is the gain applied *before* the limiter, not the change in loudness; the completion
  line says so in words. Hold and release are derived from the sample rate once per call
  (`exportLoudness` passes the rate it measured with; the public functions take an optional
  trailing `sampleRate`, default 48 000, so the ruled three-argument call still holds), pinned at
  48 and 44.1 kHz. Known limit: 5 ms is shorter than half a cycle below 100 Hz, so heavily
  limited bass is gain-modulated within each cycle (≈ 0.7 dB of ripple on a 100 Hz tone) —
  audible as distortion; a longer hold or a look-ahead is the follow-up. The tests pin the
  relative gate to the absolute-gated mean, the stereo link (a loud right channel holds a quiet
  left one), the hold and the release, each against the mutant that would break it.
- **Nothing to say.** No mix, digital silence, nothing above −70 LUFS for 400 ms, or less than
  one 400 ms block: `exportLoudness` returns `undefined`, the mix is untouched and the result
  carries no `loudness`. A gain target on such a mix is a no-op.
- **Where it shows.** `ExportResult.loudness` (`{ measuredLufs, truePeakDbtp, gainDb, targetLufs,
  limited }`) → the dialog's completion sentence, "Export complete! Measured −18.3 LUFS · gain
  +4.3 dB · the limiter held the peaks, so the mix lands below the target" (the gain only when a
  target was set, the last clause only when the limiter engaged), through the progress message, so the dialog's **one** live region announces it with
  the completion — no second region and no new dialog state. The choice is in the Advanced panel
  beside Quality (hidden for GIF, kept in `advancedOptions` like Quality), off by default,
  persisted in `lastExportSettings.loudnessTarget` and read back through `loudnessTargetOrOff`,
  so a stale or foreign value is off. The primary "Download WebM" button uses fixed defaults and
  so never normalises, exactly as it never uses the Quality choice; it still measures. The host's
  `EXPORT_COMPLETE` message is unchanged.
- **Headless.** A job's `options.loudnessTarget` reaches the exporter through the options spread
  in `renderProject.ts`, and the measurement reaches `RenderMeta.loudness` as the kit manifest's
  four fields, `{ measuredLufs, truePeakDbtp, gainDb, targetLufs }` (no `limited`). The kit's
  Chromium suite holds `measuredLufs` to ffmpeg's `ebur128` within ±0.3 LU on seeded pink noise
  and the delivered WebM to a −23 LUFS target within ±0.5 LU.
- Written from the public specification; storytold/filmcraft's `crates/audio-dsp/src/loudness.rs`
  was read as a cross-check of the K-weighting constants and the Tech 3341 cases, not ported, so
  there is no NOTICE entry.
