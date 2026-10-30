<!-- Moved verbatim from CLAUDE.md on 2026-10-19. Edit here; CLAUDE.md only indexes this file. -->
# Key Constraints

- WebCodecs (ESCAPEARTIST exports) is no longer Chrome/Edge only, and which *codecs* a browser
  that has it can actually encode varies — measured 2026-10-02 on the Playwright 1.63 browsers,
  on a secure origin (`about:blank` is not one and reports no WebCodecs at all): Chromium 153 and
  WebKit 26.6 have `VideoEncoder` with H.264, VP9, VP8 **and** AAC; **Firefox 155 has all three
  video codecs and no AAC encoder**. So both `isMP4ExportSupported(width, height)` and
  `isWebMExportSupported(width, height)` are real asynchronous probes of what this browser can
  configure at the output size, and both answer two questions, `{ video, audio }`, because the two
  failures differ in kind: no picture codec means no export in that format at all, while no audio
  codec (AAC for MP4, Opus for WebM) means a file with no sound in it.
  A browser can therefore offer one format and not the other, or offer MP4 knowing it will be
  silent, and the export dialog says which before the click and what happened after it, rather
  than offering a button that fails the instant it is clicked (ESCSUITE-22/29 gave WebM its video
  probe; ESCSUITE-175 gave MP4 the same and gave both the audio half — it also moved the H.264
  ladder and the AAC probe ahead of mixing the audio and loading the media, so a refusal costs
  nothing). See `apps/artist/CLAUDE.md`'s

  configure at the output size — MP4's answers two questions, `{ video, audio }`, because the two
  failures differ in kind: no H.264 means no MP4 at all, no AAC means an MP4 with no sound in it.

  A browser can therefore offer one format and not the other, or offer MP4 knowing it will be
  silent, and the export dialog says which before the click and what happened after it, rather
  than offering a button that fails the instant it is clicked (ESCSUITE-22/29 gave WebM its video
  probe; ESCSUITE-175 gave MP4 the same and gave both the audio half — it also moved the H.264
  ladder and the AAC probe ahead of mixing the audio and loading the media, so a refusal costs
  nothing). See `apps/artist/CLAUDE.md`'s
  "Export Dialog Browser Support"
- MediaRecorder produces WebM without proper seek metadata (requires post-processing: `webm-duration-fix`
  for the Duration, then — since ESCSUITE-322 — `apps/craft/src/core/webmCues.ts` for a Cues index of every
  video keyframe, because the library cues SimpleBlocks only and Chrome writes a composited-PiP take's
  alpha-VP9 frames as BlockGroups, leaving a 0-byte Cues that Firefox's seek wedges on; guarded
  end to end by `apps/e2e`'s `pip-seekable` specs, one per build pipeline, which read the stored take's
  Cues back; composited PiP takes,
  audio-only takes and any browser without WebCodecs all reach that path, but a composited PiP
  take is the only one the specs can drive in headless Chromium. A separate-tracks PiP take is
  recorded by `WebCodecsRecorder` and needs no repair)
- AudioContext needs `resume()` call due to Chrome autoplay policy
- A browser with no working audio output device (Firefox with no sound server) never starts an AudioContext: `resume()` never settles. CRAFT's recorders wait at most 5 s (`apps/craft/src/core/audioContextStart.ts`, ESCSUITE-390) and then fail the take with a notice naming the audio. For this reason ESCSUITE-389 gives the nightly's runner a PulseAudio sink (a pipe sink timed by the system clock since ESCSUITE-396: on `module-null-sink`, an unmuted `<video>` in Firefox stalls at `currentTime` 0 or crawls, as ESCSUITE-389 saw in Chromium)
- System audio capture only works with getDisplayMedia (Chrome/Edge)
