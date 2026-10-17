#!/usr/bin/env node
/**
 * Read what `tests/perf/craft-av-drift.spec.ts` left in
 * `apps/e2e/av-drift-results/<mode>-<load>/` and print one Markdown table per
 * arm, with a verdict line per hypothesis (ESCSUITE-296/297; the rules are the
 * hunt report's "What confirms what").
 *
 *     node apps/e2e/scripts/av-drift-report.mjs [result-dir ...] [--flash=luma|scene]
 *
 * The ESCAPEARTIST arm (`tests/perf/artist-av-drift.spec.ts`, ESCSUITE-297)
 * leaves `av-drift-results/artist-<browser>/`: the ESCAPECRAFT raw WebM it
 * imported (`raw`) and the editor's exports of it (`artist-webm`,
 * `artist-mp4`), each read the same way below, with an H4 verdict comparing
 * each export's drift slope with the source's.
 *
 * With no directories it reads every arm under `apps/e2e/av-drift-results/`.
 * The report is printed and also written to `av-drift-results/report.md`.
 *
 * Node built-ins plus `ffprobe` / `ffmpeg` on PATH (`FFPROBE` / `FFMPEG`
 * override them). Every call is `spawnSync` with an argv array, never a shell.
 *
 * Per file:
 * - stream ends — video: the largest packet pts; audio: last pts + its duration;
 * - audio PTS continuity — gaps (next pts − (pts + duration) > 1 ms) and their sum;
 * - flash onsets — per-frame luma (`signalstats` YAVG) crossing up through
 *   {@link LUMA_THRESHOLD}; `scene` detection is counted alongside as a check
 *   (it fires on both edges of a flash, so it is a diagnostic, not the onset list);
 * - beep onsets — `silencedetect=n=-30dB:d=0.05` `silence_end`, kept only where a
 *   new silence starts 30–500 ms later (a 100 ms beep), which drops the
 *   end-of-stream flush;
 * - offsets — each beep paired with the nearest flash, tracking the previous
 *   pair's offset so a drift of several seconds still pairs the right markers;
 *   least squares `offset(t) = a + b·t` with `a` in ms and `b` in ms per minute
 *   (positive = audio later than its picture, i.e. audio lags);
 * - grid fits — each track's onsets against the 10 s wall-clock schedule they
 *   were emitted on, so a track's own rate error is visible without the other
 *   (audio-only takes have nothing else);
 * - **timecode** — the primary measure wherever there is video. Every synthetic
 *   frame carries its paint time (`performance.now() − t0`, ms) as a 32-cell
 *   strip along its top edge (`utils/media-mocks.ts`), decoded here per frame
 *   with a parity check. At each beep's file time the picture's wall time is
 *   interpolated from the timecoded frames around it, and the beep's own wall
 *   time is its slot on the schedule, so A/V offset = picture wall time − beep
 *   wall time (positive: audio lags), one sample per beep, unaffected by
 *   however many frames the recorder dropped — which is what defeats the flash
 *   pairing under load (a 100 ms flash is often not captured at all at the
 *   7.5 fps the `jank` load leaves). The same strip gives the video track's own
 *   rate against the wall clock from every frame.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const RESULTS_ROOT = path.resolve(HERE, '../av-drift-results')
const FFPROBE = process.env.FFPROBE ?? 'ffprobe'
const FFMPEG = process.env.FFMPEG ?? 'ffmpeg'

/** One ScriptProcessor buffer: 4096 samples at 48 kHz. */
const BUFFER_MS = (4096 / 48000) * 1000
/** Marker period and pulse, as `utils/media-mocks.ts` emits them. */
const PERIOD_S = 10
/** YAVG (0–255) above which a frame is a flash; the pattern peaks near 170. */
const LUMA_THRESHOLD = 210
/** One frame at 30 fps, the smallest offset change worth calling a change. */
const FRAME_MS = 1000 / 30
/**
 * A flash onset is only as precise as the gap to the frame before it: under a
 * janked main thread the recorder drops frames (7.5 fps in the 60 s `jank`
 * debug run), so the first white frame can land up to that gap after the
 * flash began. Onsets after a gap longer than this are counted but kept out of
 * every fit.
 */
const MAX_ONSET_GAP_S = 2.5 / 30
/** A beep is the 100 ms pulse; a burst outside this length is not one. */
const BEEP_MIN_S = 0.06
const BEEP_MAX_S = 0.2

const args = process.argv.slice(2)
const flashMethod = (args.find((a) => a.startsWith('--flash=')) ?? '--flash=luma').slice('--flash='.length)
const dirs = args.filter((a) => !a.startsWith('--'))

function run(cmd, argv) {
  const result = spawnSync(cmd, argv, { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 })
  if (result.error) throw new Error(`${cmd}: ${result.error.message}`)
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', status: result.status }
}

function streamsOf(file) {
  const { stdout } = run(FFPROBE, ['-v', 'error', '-show_entries', 'stream=index,codec_type,codec_name', '-of', 'json', file])
  try {
    return JSON.parse(stdout).streams ?? []
  } catch {
    return []
  }
}

function packets(file, selector) {
  const { stdout } = run(FFPROBE, [
    '-v', 'error', '-select_streams', selector,
    '-show_entries', 'packet=pts_time,duration_time', '-of', 'csv=p=0', file,
  ])
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [pts, dur] = line.split(',')
      return { pts: Number(pts), dur: Number(dur) }
    })
    .filter((p) => Number.isFinite(p.pts))
    .sort((x, y) => x.pts - y.pts)
}

function median(values) {
  if (values.length === 0) return NaN
  const s = [...values].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function audioFacts(file) {
  const list = packets(file, 'a:0')
  if (list.length === 0) return null
  const deltas = list.slice(1).map((p, i) => p.pts - list[i].pts)
  const fallback = median(deltas)
  const durOf = (p) => (Number.isFinite(p.dur) && p.dur > 0 ? p.dur : fallback)
  let gaps = 0
  let gapMs = 0
  let overlaps = 0
  let largestGapMs = 0
  for (let i = 0; i + 1 < list.length; i++) {
    const hole = (list[i + 1].pts - (list[i].pts + durOf(list[i]))) * 1000
    if (hole > 1) {
      gaps++
      gapMs += hole
      largestGapMs = Math.max(largestGapMs, hole)
    } else if (hole < -1) {
      overlaps++
    }
  }
  const last = list[list.length - 1]
  return {
    packets: list.length,
    start: list[0].pts,
    end: last.pts + durOf(last),
    gaps,
    gapMs,
    largestGapMs,
    overlaps,
  }
}

function videoFacts(file) {
  const list = packets(file, 'v:0')
  if (list.length === 0) return null
  return { packets: list.length, start: list[0].pts, end: Math.max(...list.map((p) => p.pts)) }
}

function lumaFlashes(file) {
  const { stderr } = run(FFMPEG, [
    '-hide_banner', '-nostats', '-i', file, '-map', '0:v:0',
    '-vf', 'scale=64:36,signalstats,metadata=print:key=lavfi.signalstats.YAVG',
    '-an', '-f', 'null', '-',
  ])
  const frames = []
  let pending = null
  for (const line of stderr.split('\n')) {
    const at = /pts_time:([-\d.]+)/.exec(line)
    if (at) pending = Number(at[1])
    const y = /lavfi\.signalstats\.YAVG=([\d.]+)/.exec(line)
    if (y && pending !== null) {
      frames.push([pending, Number(y[1])])
      pending = null
    }
  }
  const onsets = []
  let uncertain = 0
  for (let i = 1; i < frames.length; i++) {
    if (frames[i][1] > LUMA_THRESHOLD && frames[i - 1][1] <= LUMA_THRESHOLD) {
      if (frames[i][0] - frames[i - 1][0] <= MAX_ONSET_GAP_S) onsets.push(frames[i][0])
      else uncertain++
    }
  }
  return { onsets, uncertain, frames: frames.length, peakLuma: Math.max(0, ...frames.map((f) => f[1])) }
}

function sceneChanges(file) {
  const { stderr } = run(FFMPEG, [
    '-hide_banner', '-nostats', '-i', file, '-map', '0:v:0',
    '-vf', "select='gt(scene,0.4)',showinfo", '-an', '-f', 'null', '-',
  ])
  return stderr
    .split('\n')
    .filter((l) => l.includes('Parsed_showinfo'))
    .map((l) => /pts_time:([-\d.]+)/.exec(l))
    .filter(Boolean)
    .map((m) => Number(m[1]))
}

function beeps(file) {
  const { stderr } = run(FFMPEG, [
    '-hide_banner', '-nostats', '-i', file, '-map', '0:a:0',
    '-af', 'silencedetect=n=-30dB:d=0.05', '-vn', '-f', 'null', '-',
  ])
  const events = []
  for (const line of stderr.split('\n')) {
    const s = /silence_start: ([-\d.]+)/.exec(line)
    if (s) events.push(['start', Number(s[1])])
    const e = /silence_end: ([-\d.]+)/.exec(line)
    if (e) events.push(['end', Number(e[1])])
  }
  const onsets = []
  const lengths = []
  let bursts = 0
  for (let i = 0; i < events.length; i++) {
    if (events[i][0] !== 'end') continue
    const next = events.slice(i + 1).find((ev) => ev[0] === 'start')
    if (!next) continue
    const length = next[1] - events[i][1]
    if (length >= BEEP_MIN_S && length <= BEEP_MAX_S) {
      onsets.push(events[i][1])
      lengths.push(length)
    } else {
      // Sound that is not a 100 ms beep: a glitch in the recorded content.
      bursts++
    }
  }
  return { onsets, bursts, medianLengthMs: median(lengths) * 1000 }
}

/** Least squares y = a + b·x; returns the slope's standard error too. */
function fit(points) {
  const n = points.length
  if (n < 2) return null
  const mx = points.reduce((s, p) => s + p[0], 0) / n
  const my = points.reduce((s, p) => s + p[1], 0) / n
  let sxx = 0
  let sxy = 0
  for (const [x, y] of points) {
    sxx += (x - mx) ** 2
    sxy += (x - mx) * (y - my)
  }
  if (sxx === 0) return { n, a: my, b: 0, seB: Infinity, rms: 0 }
  const b = sxy / sxx
  const a = my - b * mx
  const sse = points.reduce((s, [x, y]) => s + (y - a - b * x) ** 2, 0)
  const seB = n > 2 ? Math.sqrt(sse / (n - 2) / sxx) : Infinity
  return { n, a, b, seB, rms: Math.sqrt(sse / n) }
}

/**
 * Pair each `later` onset with the nearest `reference` onset, predicting from
 * the previous pair's offset so a growing drift still pairs the right
 * markers. Returns `[referenceTime s, offset ms]`.
 */
function pair(reference, later) {
  const pairs = []
  let predicted = 0
  const used = new Set()
  for (const t of later) {
    let best = -1
    let bestErr = Infinity
    reference.forEach((r, i) => {
      if (used.has(i)) return
      const err = Math.abs(t - r - predicted)
      if (err < bestErr) {
        bestErr = err
        best = i
      }
    })
    if (best < 0 || bestErr > PERIOD_S * 0.3) continue
    used.add(best)
    const offset = t - reference[best]
    pairs.push([reference[best], offset * 1000])
    predicted = offset
  }
  return pairs.sort((x, y) => x[0] - y[0])
}

/** Offset fit against time in minutes: a in ms, b in ms per minute. */
function offsetFit(pairs) {
  return fit(pairs.map(([t, ms]) => [t / 60, ms]))
}

/** A track's onsets against the 10 s schedule they were emitted on. */
function gridFit(onsets) {
  if (onsets.length < 2) return null
  const t0 = onsets[0]
  return fit(onsets.map((t) => [t / 60, (t - t0 - PERIOD_S * Math.round((t - t0) / PERIOD_S)) * 1000]))
}

/**
 * `[pts s, paint ms]` per frame whose timecode strip decodes with good parity.
 * The strip is cells of width/40 px from the top-left corner; the middle half
 * of each cell's height is cropped, averaged to one pixel per cell and
 * thresholded at mid-grey.
 */
function timecodes(file) {
  const result = spawnSync(
    FFMPEG,
    [
      '-hide_banner', '-nostats', '-i', file, '-map', '0:v:0',
      '-vf', 'crop=w=iw*32/40:h=iw/80:x=0:y=iw/160,scale=32:1:flags=area,showinfo',
      // Passthrough is load-bearing: without it the rawvideo output is made
      // constant-rate, duplicating frames of a variable-rate take after the
      // filter graph, and the bytes stop lining up with showinfo's pts lines
      // (it read a 60 s janked take as 17 s of content).
      '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'gray', '-',
    ],
    { maxBuffer: 512 * 1024 * 1024 }
  )
  if (result.error) throw new Error(`${FFMPEG}: ${result.error.message}`)
  const pts = String(result.stderr)
    .split('\n')
    .filter((l) => l.includes('Parsed_showinfo') && l.includes('pts_time:'))
    .map((l) => Number(/pts_time:([-\d.]+)/.exec(l)[1]))
  const bytes = result.stdout
  const frames = []
  let bad = 0
  for (let i = 0; i < pts.length && (i + 1) * 32 <= bytes.length; i++) {
    let value = 0
    let parity = 0
    for (let bit = 0; bit < 31; bit++) {
      const on = bytes[i * 32 + bit] >= 128 ? 1 : 0
      parity ^= on
      value = value * 2 + on
    }
    const check = bytes[i * 32 + 31] >= 128 ? 1 : 0
    if (check === parity) frames.push([pts[i], value])
    else bad++
  }
  // A decode that passes parity but lands far from its neighbours' trend
  // (two flipped bits) is dropped against the median lag.
  const lags = frames.map(([t, v]) => v - t * 1000)
  const mid = median(lags)
  const kept = frames.filter((_, i) => Math.abs(lags[i] - mid) < 5000)
  return { frames: kept, bad: bad + frames.length - kept.length, total: pts.length }
}

/**
 * The wall time of the picture at file time `t`: `t` plus the 90th percentile
 * of `paint − file time` over the timecoded frames within ±2 s.
 *
 * Not the nearest frame's own paint time: a frame's content is up to one
 * paint interval older than its capture, and the synthetic painter's 33 ms
 * `setInterval` beats against the 30 Hz capture (ESCSUITE-86), so `paint −
 * pts` is a ~3.3 s sawtooth 0–33 ms deep (measured on the 40 s idle debug
 * take). Its upper envelope — the freshest content — is the capture-to-stamp
 * relation; the 90th percentile reads it while shrugging off a stray decode.
 * Null where no frame lies within the window.
 */
function wallAt(frames, t) {
  let lo = 0
  let hi = frames.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (frames[mid][0] < t - 2) lo = mid + 1
    else hi = mid
  }
  const lags = []
  for (let i = lo; i < frames.length && frames[i][0] <= t + 2; i++) lags.push(frames[i][1] - frames[i][0] * 1000)
  if (lags.length === 0) return null
  lags.sort((a, b) => a - b)
  return t * 1000 + lags[Math.min(lags.length - 1, Math.floor(lags.length * 0.9))]
}

/**
 * A/V offset per beep against a timecoded picture: `[beep file time s,
 * picture wall ms − beep wall ms]`. The beep's slot is the schedule slot
 * nearest the picture's wall time, so offsets up to half a period are read
 * correctly.
 */
function timecodeOffsets(frames, beepOnsets, periodMs) {
  const out = []
  for (const t of beepOnsets) {
    const wall = wallAt(frames, t)
    if (wall === null) continue
    const slot = Math.round(wall / periodMs) * periodMs
    out.push([t, wall - slot])
  }
  return out
}

/** Picture-vs-picture: `[t, wall(other at t) − wall(reference at t)]` sampled once a second. */
function timecodeVideoOffsets(reference, other) {
  const out = []
  if (other.length === 0) return out
  for (let t = Math.ceil(other[0][0]); t <= other[other.length - 1][0]; t++) {
    const a = wallAt(reference, t)
    const b = wallAt(other, t)
    if (a !== null && b !== null) out.push([t, b - a])
  }
  return out
}

function analyseFile(dir, entry, periodMs) {
  const file = path.join(dir, entry.file)
  const kinds = new Set(streamsOf(file).map((s) => s.codec_type))
  const facts = { ...entry, hasVideo: kinds.has('video'), hasAudio: kinds.has('audio') }
  if (facts.hasVideo) {
    facts.video = videoFacts(file)
    const luma = lumaFlashes(file)
    facts.luma = { frames: luma.frames, peak: luma.peakLuma }
    facts.sceneChanges = sceneChanges(file).length
    facts.flashes = flashMethod === 'scene' ? sceneChanges(file) : luma.onsets
    facts.uncertainFlashes = flashMethod === 'scene' ? 0 : luma.uncertain
    facts.videoGrid = gridFit(facts.flashes)
    const tc = timecodes(file)
    facts.timecode = tc
    // The picture's own rate against the wall clock: paint time − file time.
    facts.videoTc = fit(tc.frames.map(([t, w]) => [t / 60, w - t * 1000]))
  }
  if (facts.hasAudio) {
    facts.audio = audioFacts(file)
    const b = beeps(file)
    facts.beeps = b.onsets
    facts.bursts = b.bursts
    facts.beepLengthMs = b.medianLengthMs
    facts.audioGrid = gridFit(facts.beeps)
  }
  if (facts.hasVideo && facts.hasAudio) {
    facts.self = offsetFit(pair(facts.flashes, facts.beeps))
    facts.tc = offsetFit(timecodeOffsets(facts.timecode.frames, facts.beeps, periodMs))
  }
  return facts
}

const f = (v, digits = 1) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(digits))
const signed = (v, digits = 1) => (!Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(digits)}`)
const fitText = (r) => (r ? `${signed(r.b, 2)} ± ${f(r.seB, 2)}` : '—')
const significant = (r, minutes) =>
  !!r && Number.isFinite(r.seB) && Math.abs(r.b) > 3 * r.seB && Math.abs(r.b) * minutes > FRAME_MS

/**
 * The fix's gap-fill rule (ESCSUITE-296, after the rig's 2026-10-15 jank
 * measurement): Chromium's `playbackTime` is read at *dispatch* — one buffer
 * ahead of `currentTime` at dispatch at p5–p95 under the `jank` load, its
 * offset tracking dispatch lateness with r = 1.00 — so a merely late callback
 * looks like a gap. That take showed lateness above half a buffer sustained
 * across 8 callbacks with nothing lost, so a loss is counted only when the
 * minimum offset over the last max(8 callbacks, ~2 s) reaches 0.95 of a
 * buffer, and then whole buffers are filled.
 */
const FILL_THRESHOLD_BUFFERS = 0.95
const FILL_WINDOW_MIN_CALLBACKS = 8
const FILL_WINDOW_SECONDS = 2

/**
 * `playbackTime` semantics and lost-callback counts for one ScriptProcessor
 * node (ESCSUITE-296 review). `calls` are `[playbackTime, perfNow, ctxNow,
 * bufferLength, sampleRate]`. Returns
 * - `naive`: Σ (round(Δplayback / buffer) − 1), every term rounded on its own;
 * - `robust`: the fix's rule — expected = anchor + samples delivered ÷ rate,
 *   offset = playbackTime − expected; a loss is counted only when the minimum
 *   offset over the last max(8 callbacks, ~2 s) reaches 0.95 of a buffer
 *   (`FILL_THRESHOLD_BUFFERS`), and then whole buffers are filled and the
 *   anchor advances by the buffers filled;
 * - the offset and dispatch-interval distributions (ms: min, p50, p95, max);
 * - `r` / `slope`: offset against dispatch lateness (how far each callback ran
 *   behind its steady schedule) — near 1 when `playbackTime` is read at
 *   dispatch, near 0 with a flat offset when it is the render position;
 * - `verdict`: one line.
 */
const spStats = (calls, bufferSize, sampleRate) => {
  const n = calls.length
  if (n < 2) return null
  const period = bufferSize / sampleRate
  const windowSize = Math.max(FILL_WINDOW_MIN_CALLBACKS, Math.ceil(FILL_WINDOW_SECONDS / period))
  let naive = 0
  let aligned = 0
  for (let i = 1; i < n; i++) {
    const delta = calls[i][0] - calls[i - 1][0]
    const steps = Math.round(delta / period)
    naive += steps - 1
    if (Math.abs(delta - steps * period) < 0.001) aligned++
  }
  const anchor = calls[0][0]
  let delivered = 0
  let robust = 0
  const recent = []
  const offsets = []
  const lateness = []
  for (let i = 0; i < n; i++) {
    let expectedRel = delivered / sampleRate
    let offset = calls[i][0] - anchor - expectedRel
    recent.push(offset)
    if (recent.length > windowSize) recent.shift()
    if (recent.length === windowSize) {
      const least = Math.min(...recent)
      if (least >= FILL_THRESHOLD_BUFFERS * period) {
        const filled = Math.max(1, Math.round(least / period))
        robust += filled
        delivered += filled * bufferSize
        expectedRel = delivered / sampleRate
        offset -= filled * period
        for (let j = 0; j < recent.length; j++) recent[j] -= filled * period
      }
    }
    offsets.push(offset * 1000)
    lateness.push(calls[i][1] - calls[0][1] - expectedRel * 1000)
    delivered += calls[i][3] || bufferSize
  }
  const sorted = (xs) => [...xs].sort((a, b) => a - b)
  const q = (xs, p) => xs[Math.min(xs.length - 1, Math.floor(p * xs.length))]
  const dist = (xs) => {
    const s = sorted(xs)
    return { min: s[0], p50: q(s, 0.5), p95: q(s, 0.95), max: s[s.length - 1] }
  }
  const dispatch = calls.slice(1).map((c, i) => c[1] - calls[i][1])
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length
  const mo = mean(offsets)
  const ml = mean(lateness)
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let i = 0; i < n; i++) {
    sxy += (lateness[i] - ml) * (offsets[i] - mo)
    sxx += (lateness[i] - ml) ** 2
    syy += (offsets[i] - mo) ** 2
  }
  const r = sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0
  const slope = sxx > 0 ? sxy / sxx : 0
  const so = sorted(offsets)
  const offsetSpread = q(so, 0.95) - q(so, 0.05)
  const sl = sorted(lateness.map((x) => x - q(sorted(lateness), 0.5)))
  const jitter = q(sl, 0.95) - q(sl, 0.05)
  const fmt = (x) => x.toFixed(1)
  let verdict
  if (offsetSpread < 1) {
    verdict =
      jitter > 5
        ? `render-position-based: offset flat (p5–p95 spread ${fmt(offsetSpread)} ms) while dispatch lateness swings ${fmt(jitter)} ms`
        : `render-position-based as far as this shows, but dispatch lateness only swings ${fmt(jitter)} ms — too little jitter to tell`
  } else if (r > 0.7) {
    verdict = `dispatch-time-based: offset follows dispatch lateness (r = ${r.toFixed(2)}, slope ${slope.toFixed(2)}; offset spread ${fmt(offsetSpread)} ms, lateness swing ${fmt(jitter)} ms)`
  } else {
    verdict = `unclear: offset spread ${fmt(offsetSpread)} ms, r = ${r.toFixed(2)} against a lateness swing of ${fmt(jitter)} ms`
  }
  // Direct check, where the page logged `currentTime` at dispatch: a
  // render-position playbackTime moves independently of it, a dispatch-time
  // one sits a constant buffer ahead of it.
  const ahead = calls.filter((c) => Number.isFinite(c[2]) && c[2] > 0).map((c) => (c[0] - c[2]) * 1000)
  const aheadDist = ahead.length > 1 ? dist(ahead) : null
  if (aheadDist) {
    const sa = sorted(ahead)
    verdict += `; playbackTime − currentTime at dispatch: p50 ${fmt(aheadDist.p50)} ms, p5–p95 spread ${fmt(q(sa, 0.95) - q(sa, 0.05))} ms`
  }
  // The content deficit, not rounded to buffers: the floor of the raw
  // (never-filled) offset over the last window. In the 60 s jank take it crept
  // up in render-quantum steps (128 samples, 2.67 ms) to ~43 ms with every
  // callback accounted for — loss smaller than a buffer, which a rule that
  // fills whole buffers cannot see.
  const rawTail = calls.slice(-windowSize).map((c, i, tail) => {
    const index = n - tail.length + i
    return (c[0] - anchor - (index * bufferSize) / sampleRate) * 1000
  })
  const deficitAtEndMs = Math.min(...rawTail)
  return {
    deficitAtEndMs,
    playbackMinusCurrentTimeMs: aheadDist,
    callbacks: n,
    naive,
    robust,
    alignedShare: aligned / (n - 1),
    offsetMs: dist(offsets),
    dispatchIntervalMs: dist(dispatch),
    latenessSwingMs: jitter,
    offsetSpreadMs: offsetSpread,
    r,
    slope,
    verdict,
  }
}

/**
 * Lost callbacks per node from `sp-log.json`, recomputed here so an arm run by
 * an older rig is read by today's rule (the telescoping sum — see
 * `utils/avDrift.ts`) — mirrors `lostPerNode` in the spec.
 */
function nodesFromLog(dir, m) {
  const file = path.join(dir, 'sp-log.json')
  if (!existsSync(file)) return m.nodes
  const { startPerf: from, stopPerf: to } = m.window
  return JSON.parse(readFileSync(file, 'utf8')).map((node) => {
    const period = node.bufferSize / node.sampleRate
    const w = node.calls.filter(([, at]) => at >= from && at <= to)
    let aligned = 0
    let above = 0
    let maxGap = 0
    for (let i = 1; i < w.length; i++) {
      const delta = w[i][0] - w[i - 1][0]
      const steps = Math.round(delta / period)
      if (Math.abs(delta - steps * period) < 0.001) aligned++
      if (steps > 1) above++
      maxGap = Math.max(maxGap, w[i][1] - w[i - 1][1])
    }
    const span = w.length > 1 ? w[w.length - 1][1] - w[0][1] : 0
    const lost = w.length > 1 ? Math.round((w[w.length - 1][0] - w[0][0]) / period) - (w.length - 1) : 0
    return {
      contextIndex: node.contextIndex,
      // Same function the page exposes as `__spStats()` (utils/avDrift.ts),
      // recomputed from the log so an arm is always read by today's rule.
      stats: spStats(w, node.bufferSize, node.sampleRate),
      callsInWindow: w.length,
      lostInWindow: lost,
      lostByPerfSpan: w.length > 1 ? Math.round(span / 1000 / period) - (w.length - 1) : 0,
      alignedStepShare: w.length > 1 ? aligned / (w.length - 1) : null,
      stepsAboveOne: above,
      largestDispatchGapMs: maxGap,
    }
  })
}

/** The per-file table, shared by the ESCAPECRAFT and ESCAPEARTIST arms. */
function fileTableLines(files, comparisons) {
  const out = []
  out.push('| File | Kind | Role | videoEnd s | audioEnd s | audioEnd−videoEnd ms | audio PTS gaps (n / Σ ms) | timecoded frames (bad) | beeps (+bursts) | **a ms (timecode)** | **b ms/min ± SE (timecode)** | flashes (+uncertain) [scene] | flash pairs: a ms / b ms/min | grid b audio | grid b video | video vs wall b (timecode) |')
  out.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---')
  for (const x of files) {
    const ve = x.video?.end
    const ae = x.audio?.end
    out.push(
      `| ${x.file}${x.note ? ` (${x.note})` : ''} | ${x.kind} | ${x.role} | ${f(ve, 3)} | ${f(ae, 3)} | ${ve !== undefined && ae !== undefined ? signed((ae - ve) * 1000) : '—'} | ${x.audio ? `${x.audio.gaps} / ${f(x.audio.gapMs)}` : '—'} | ${x.timecode ? `${x.timecode.frames.length} (${x.timecode.bad})` : '—'} | ${x.beeps ? `${x.beeps.length} (+${x.bursts})` : '—'} | ${x.tc ? signed(x.tc.a) : '—'} | ${x.tc ? `${fitText(x.tc)} (n ${x.tc.n})` : '—'} | ${x.flashes ? `${x.flashes.length} (+${x.uncertainFlashes}) [${x.sceneChanges}]` : '—'} | ${x.self ? `${signed(x.self.a)} / ${fitText(x.self)} (n ${x.self.n})` : '—'} | ${fitText(x.audioGrid)} | ${fitText(x.videoGrid)} | ${fitText(x.videoTc)} |`
    )
  }
  for (const c of comparisons) {
    out.push(`| ${c.label} | pair | | | | | | | | ${c.fit ? signed(c.fit.a) : '—'} | ${c.fit ? `${fitText(c.fit)} (n ${c.fit.n})` : '—'} | | | | | |`)
  }
  return out
}

/**
 * Hypothesis H4 for ESCAPEARTIST (ESCSUITE-297), from what
 * `tests/perf/artist-av-drift.spec.ts` left: the ESCAPECRAFT raw WebM it
 * imported (copied in as `raw`) and the editor's exports of it
 * (`artist-webm` / `artist-mp4`). Each file is read exactly as an ESCAPECRAFT
 * file is — its own picture's timecode against its own beeps — so an export's
 * drift slope sits beside the source's. A decoder that spliced the source's
 * audio PTS gaps shut would make an export's audio lead its picture by the gaps
 * accumulated so far: b ≈ −Σgaps ÷ minutes, relative to the source.
 */
const SPLICE_MIN_MS_PER_MIN = 20
const FLAT_MS_PER_MIN = 3

function analyseArtistArm(dir, m, files, rawPrimary, minutes) {
  const best = (x) => (x?.tc && x.tc.n >= 2 ? x.tc : x?.self)
  const raw = best(rawPrimary)
  const lines = []
  lines.push(`### ${path.basename(dir)} — ESCAPEARTIST export, ${m.browser}, ${f(m.window.seconds, 1)} s timeline`)
  lines.push('')
  lines.push('| Instrument | Value |')
  lines.push('|---|---|')
  lines.push(`| source | ${m.source?.path ?? '—'}${m.source?.arm ? ` (ESCAPECRAFT ${m.source.arm.mode}-${m.source.arm.load}, ${m.source.arm.recorder})` : ''} |`)
  lines.push(`| project / clip | ${m.projectResolution ? `${m.projectResolution.width}x${m.projectResolution.height}` : '—'}, clip ${f(m.clip?.duration, 3)} s |`)
  lines.push(`| exports | ${m.files.filter((x) => x.kind !== 'raw').map((x) => `${x.kind} in ${f(x.exportSeconds, 0)} s`).join('; ') || '—'} |`)
  lines.push(`| lost callbacks | n/a — no capture in this arm |`)
  lines.push('')
  lines.push(...fileTableLines(files, []))
  lines.push('')

  const verdicts = []
  const gaps = rawPrimary?.audio?.gaps ?? 0
  const gapMs = rawPrimary?.audio?.gapMs ?? 0
  const predicted = -gapMs / minutes
  if (!raw) {
    verdicts.push('**H4 (ESCAPEARTIST)**: inconclusive — no drift fit for the source.')
  } else {
    // A fit is usable with three or more points and a finite slope error.
    const usable = (r) => !!r && r.n >= 3 && Number.isFinite(r.seB)
    const classify = (r, ref) => {
      if (!usable(r) || !usable(ref)) return { state: 'inconclusive', delta: NaN, se: NaN }
      const delta = r.b - ref.b
      const se = Math.sqrt(r.seB ** 2 + ref.seB ** 2)
      const state =
        Math.abs(delta) > SPLICE_MIN_MS_PER_MIN && Math.abs(delta) > 3 * se
          ? 'spliced'
          : Math.abs(delta) <= Math.max(FLAT_MS_PER_MIN, 3 * se)
            ? 'flat'
            : 'inconclusive'
      return { state, delta, se }
    }
    const outcomes = []
    for (const x of files.filter((y) => y.kind.startsWith('artist-'))) {
      // A/V against the export's own picture (timecode), and — needing no
      // picture at all — the export's beeps against the 10 s schedule they
      // were emitted on, beside the source's: a splice moves every later beep
      // earlier, so it shows on the audio grid too.
      const av = classify(best(x), raw)
      const grid = classify(x.audioGrid, rawPrimary?.audioGrid)
      const state = av.state !== 'inconclusive' ? av.state : grid.state
      const endDiff = x.video && x.audio ? (x.audio.end - x.video.end) * 1000 : NaN
      const pictureNote = usable(best(x)) ? '' : ' (picture unreadable: no usable timecode fit, so the audio grid decides)'
      outcomes.push({
        x,
        state,
        text:
          `${x.kind}: A/V b = ${fitText(best(x))} ms/min (Δ vs source ${signed(av.delta, 2)} ± ${f(av.se, 2)}); ` +
          `audio grid b = ${fitText(x.audioGrid)} (Δ vs source ${signed(grid.delta, 2)} ± ${f(grid.se, 2)}); ` +
          `${x.audio ? `${x.audio.gaps} PTS gaps (Σ ${f(x.audio.gapMs)} ms)` : 'no audio'}, audioEnd−videoEnd ${signed(endDiff, 0)} ms → ${state}${pictureNote}`,
      })
    }
    const any = (state) => outcomes.some((o) => o.state === state)
    const verdict = any('spliced') ? 'CONFIRMED' : outcomes.length && outcomes.every((o) => o.state === 'flat') ? 'REFUTED' : 'inconclusive'
    verdicts.push(
      `**H4 (ESCAPEARTIST, ${m.browser})**: ${verdict} — the source has ${gaps} audio PTS gaps (Σ ${f(gapMs)} ms; a splice would read b ≈ ${signed(predicted, 0)} ms/min relative to it) and b = ${fitText(raw)} ms/min of its own.`
    )
    for (const o of outcomes) verdicts.push(`  - ${o.text}.`)
  }
  lines.push(...verdicts.map((v) => (v.startsWith('  -') ? v : `- ${v}`)))
  lines.push('')
  return lines.join('\n')
}

function analyseArm(dir) {
  const m = JSON.parse(readFileSync(path.join(dir, 'measurement.json'), 'utf8'))
  m.nodes = nodesFromLog(dir, m)
  m.lostCallbacks = m.nodes.reduce((sum, n) => sum + n.lostInWindow, 0)
  const minutes = m.window.seconds / 60
  const periodMs = m.markers?.period ?? PERIOD_S * 1000
  const files = m.files.map((entry) => analyseFile(dir, entry, periodMs))
  const rawPrimary = files.find((x) => x.kind === 'raw' && x.role === 'primary')
  const comparisons = []

  if (m.arm === 'artist') return analyseArtistArm(dir, m, files, rawPrimary, minutes)

  const m4a = files.find((x) => x.kind === 'm4a')
  if (m4a && rawPrimary?.flashes && m4a.beeps) {
    m4a.self = offsetFit(pair(rawPrimary.flashes, m4a.beeps))
    m4a.tc = offsetFit(timecodeOffsets(rawPrimary.timecode.frames, m4a.beeps, periodMs))
    m4a.note = 'against the raw WebM’s picture'
  }
  for (const companion of files.filter((x) => x.kind === 'raw' && x.role !== 'primary')) {
    if (companion.beeps && rawPrimary?.timecode) {
      comparisons.push({
        label: `${companion.role} companion beeps vs primary picture (timecode)`,
        fit: offsetFit(timecodeOffsets(rawPrimary.timecode.frames, companion.beeps, periodMs)),
      })
    }
    if (companion.timecode && rawPrimary?.timecode) {
      comparisons.push({
        label: `${companion.role} companion picture vs primary picture (timecode)`,
        fit: offsetFit(timecodeVideoOffsets(rawPrimary.timecode.frames, companion.timecode.frames)),
      })
    }
    if (companion.beeps && rawPrimary?.beeps) {
      comparisons.push({
        label: `${companion.role} companion beeps − primary mix beeps`,
        fit: offsetFit(pair(rawPrimary.beeps, companion.beeps)),
      })
    }
    if (companion.beeps && rawPrimary?.flashes) {
      comparisons.push({
        label: `${companion.role} companion beeps − primary flashes`,
        fit: offsetFit(pair(rawPrimary.flashes, companion.beeps)),
      })
    }
    if (companion.flashes && rawPrimary?.flashes) {
      comparisons.push({
        label: `${companion.role} companion flashes − primary flashes`,
        fit: offsetFit(pair(rawPrimary.flashes, companion.flashes)),
      })
    }
  }

  const appContexts = m.contexts.filter((c) => !c.synthetic)
  const recorderContexts = appContexts.filter((c) => m.nodes.some((n) => n.contextIndex === c.index))
  const clockContexts = recorderContexts.length ? recorderContexts : appContexts
  const eps = (c) => c.epsilonPpmOutputTimestamp ?? c.epsilonPpmCurrentTime

  const lines = []
  lines.push(`### ${path.basename(dir)} — ${m.mode}, ${m.load}, ${f(m.window.seconds, 1)} s, ${m.recorder}`)
  lines.push('')
  lines.push('| Instrument | Value |')
  lines.push('|---|---|')
  lines.push(
    `| lost callbacks (in window) | **${m.lostCallbacks}**${m.nodes.length ? ` — ${m.nodes.map((n, i) => `node ${i}${i === 0 ? ' (mix)' : ''}: ${n.lostInWindow} by playbackTime, ${n.lostByPerfSpan} by performance.now() span, over ${n.callsInWindow} callbacks` + `; ${n.stepsAboveOne} late steps, ${f((n.alignedStepShare ?? NaN) * 100, 0)} % buffer-aligned, longest dispatch gap ${f(n.largestDispatchGapMs, 0)} ms`).join('; ')}` : ' (no ScriptProcessor — MediaRecorder path)'} |`
  )
  lines.push(`| \`playbackTime\` exposed | ${m.nodes.length ? (m.playbackTimeAvailable ? 'yes' : '**no**') : 'n/a'} |`)
  lines.push(
    `| ε (app contexts) | ${clockContexts.map((c) => `ctx ${c.index}: ${signed(eps(c), 2)} ppm (ots), ${signed(c.epsilonPpmCurrentTime, 2)} ppm (currentTime), ${c.samplesInWindow} samples`).join('; ') || '—'} |`
  )
  lines.push(`| ε (synthetic devices) | ${m.contexts.filter((c) => c.synthetic).map((c) => `ctx ${c.index}: ${signed(eps(c), 2)} ppm`).join('; ') || '—'} |`)
  lines.push(`| sampleRate | ${appContexts.map((c) => `ctx ${c.index}: ${c.sampleRate}${c.requestedSampleRate ? ` (asked ${c.requestedSampleRate})` : ''}`).join('; ') || '—'} |`)
  lines.push(`| marker beeps scheduled / missed | ${m.markers ? `${m.markers.scheduled.length} / ${m.markers.missed.length}` : '—'} |`)
  lines.push('')
  if (m.nodes.some((n) => n.stats)) {
    const d = (x) => `${f(x.min)} / ${f(x.p50)} / ${f(x.p95)} / ${f(x.max)}`
    lines.push('| ScriptProcessor node | callbacks | lost: naive Σ(round(Δ/buf)−1) | lost: fix rule (min over max(8, ~2 s) ≥ 0.95 buf) | lost: telescoped (playbackTime / perf span) | deficit at end ms (unrounded) | buffer-aligned steps | playbackTime − expected ms (min / p50 / p95 / max) | dispatch interval ms (min / p50 / p95 / max) | r, slope (offset vs dispatch lateness) | playbackTime semantics |')
    lines.push('|---|---|---|---|---|---|---|---|---|---|---|')
    m.nodes.forEach((n, i) => {
      const st = n.stats
      if (!st) return
      lines.push(
        `| ${i}${i === 0 ? ' (mix)' : ' (companion)'} | ${st.callbacks} | ${st.naive} | ${st.robust} | ${n.lostInWindow} / ${n.lostByPerfSpan} | ${f(st.deficitAtEndMs)} | ${f(st.alignedShare * 100, 0)} % | ${d(st.offsetMs)} | ${d(st.dispatchIntervalMs)} | ${st.r.toFixed(2)}, ${st.slope.toFixed(2)} | ${st.verdict} |`
      )
    })
    lines.push('')
  }
  lines.push(...fileTableLines(files, comparisons))
  lines.push('')

  // Verdicts — the hunt report's "What confirms what".
  const k = m.lostCallbacks
  // The timecode measure wherever it has two samples; the flash pairing otherwise.
  const best = (x) => (x?.tc && x.tc.n >= 2 ? x.tc : x?.self)
  const raw = best(rawPrimary)
  const end = rawPrimary?.video && rawPrimary?.audio ? (rawPrimary.audio.end - rawPrimary.video.end) * 1000 : NaN
  const verdicts = []
  if (m.recorder === 'webcodecs') {
    const kMix = m.nodes[0]?.lostInWindow ?? 0
    const expected = -kMix * BUFFER_MS
    if (!m.playbackTimeAvailable) {
      verdicts.push('**H1a**: inconclusive — `playbackTime` is not exposed, so lost callbacks cannot be counted.')
    } else if (k === 0) {
      verdicts.push(
        m.load === 'idle'
          ? `**H1a**: not triggered at idle (k = 0; b = ${fitText(raw)} ms/min, audio vs wall grid b = ${fitText(rawPrimary?.audioGrid)}) — expected; the loaded arms decide it.`
          : `**H1a**: REFUTED under ${m.load} — k = 0 lost callbacks (Chromium queued rather than dropped; audioEnd−videoEnd ${signed(end, 0)} ms)${significant(raw, minutes) ? `, yet b = ${fitText(raw)} ms/min is significant: another cause` : `; b = ${fitText(raw)} ms/min`}, audio vs wall grid b = ${fitText(rawPrimary?.audioGrid)}.`
      )
    } else {
      const total = raw ? raw.b * minutes : NaN
      const slopeOk = raw && raw.b < 0 && significant(raw, minutes) && Math.abs(total - expected) <= Math.max(BUFFER_MS, 0.3 * Math.abs(expected))
      const endOk = Number.isFinite(end) && Math.abs(end - expected) <= BUFFER_MS + 100
      verdicts.push(
        `**H1a**: ${slopeOk && endOk ? 'CONFIRMED' : slopeOk || endOk ? 'PARTLY confirmed' : 'NOT confirmed'} — mix lost ${kMix} callbacks → expected ${signed(expected, 0)} ms; marker drift over the take ${signed(total, 0)} ms (b = ${fitText(raw)} ms/min; audio vs wall grid b = ${fitText(rawPrimary?.audioGrid)}); audioEnd−videoEnd ${signed(end, 0)} ms.`
      )
      if (m.nodes.length > 1) {
        for (const c of comparisons.filter((x) => x.label.endsWith('primary mix beeps'))) {
          const idx = c.label.startsWith('microphone') ? 1 : c.label.startsWith('system') ? m.nodes.length - 1 : -1
          if (idx < 1) continue
          const diff = -(m.nodes[idx].lostInWindow - kMix) * BUFFER_MS
          verdicts.push(
            `  - ${c.label}: drift ${signed(c.fit ? c.fit.b * minutes : NaN, 0)} ms over the take vs ${signed(diff, 0)} ms expected from the node difference (${m.nodes[idx].lostInWindow} − ${kMix}).`
          )
        }
      }
    }
  } else {
    verdicts.push('**H1a**: not applicable — MediaRecorder path, no ScriptProcessor.')
  }

  m.nodes.forEach((n, i) => {
    if (!n.stats) return
    const falseFills = n.stats.robust - Math.max(0, n.lostByPerfSpan)
    verdicts.push(
      `**playbackTime semantics** (node ${i}${i === 0 ? ', mix' : ''}): ${n.stats.verdict}. Naive count ${n.stats.naive}, fix rule ${n.stats.robust}, against ${n.lostByPerfSpan} by the performance.now() span` +
        (falseFills > 0 ? ` — **the fix rule would have filled ${falseFills} buffer(s) of silence that were never lost**.` : '.')
    )
  })

  const ctx = clockContexts[0]
  const e = ctx ? eps(ctx) : null
  if (e === null || e === undefined) {
    verdicts.push('**H1b**: no ε sample for the app context.')
  } else {
    const predicted = 0.06 * e
    const grid = rawPrimary?.audioGrid
    verdicts.push(
      Math.abs(e) < 5
        ? `**H1b**: not measurable here — ε = ${signed(e, 2)} ppm (headless fake sink runs on the system clock); predicts b ≈ ${signed(predicted, 3)} ms/min. Needs a headed run on a real output device.`
        : `**H1b**: ε = ${signed(e, 2)} ppm predicts b ≈ ${signed(predicted, 2)} ms/min; measured beep−flash b = ${fitText(raw)}, audio-vs-wall grid b = ${fitText(grid)} → ${grid && Math.abs(grid.b - predicted) <= 3 * grid.seB + 0.5 ? 'CONSISTENT' : 'NOT consistent'}.`
    )
  }

  const rates = appContexts.map((c) => c.sampleRate)
  verdicts.push(
    rates.length === 0
      ? '**H3**: no app AudioContext recorded.'
      : rates.some((r) => r !== 48000)
        ? `**H3**: CONFIRMED — an app context runs at ${rates.join(', ')} Hz, not 48000.`
        : '**H3**: refuted — every app context runs at 48000 Hz.'
  )

  if (m.recorder === 'mediarecorder') {
    const measure = raw ?? rawPrimary?.audioGrid
    const what = raw ? 'beep−flash' : 'audio vs the wall-clock grid'
    verdicts.push(
      `**H2**: ${significant(measure, minutes) ? 'CONFIRMED' : 'refuted'} — raw WebM ${what} b = ${fitText(measure)} ms/min (${signed(measure ? measure.b * minutes : NaN, 0)} ms over the take).`
    )
  }

  if (rawPrimary?.audio) {
    const mp4 = files.find((x) => x.kind === 'mp4')
    const gaps = rawPrimary.audio.gaps
    if (!mp4 && !m4a) {
      verdicts.push(`**H4**: input only — raw WebM audio has ${gaps} PTS gaps (Σ ${f(rawPrimary.audio.gapMs)} ms); this arm makes no conversions.`)
    } else if (gaps === 0) {
      verdicts.push(
        `**H4**: not applicable — raw WebM audio has no PTS gaps; MP4 b = ${fitText(best(mp4))}, M4A b = ${fitText(best(m4a))} ms/min (raw ${fitText(raw)}; any drift there is inherited, not made by the converter).`
      )
    } else {
      const derivedEarly = [best(mp4), best(m4a)].some((r) => r && r.b < 0 && significant(r, minutes))
      verdicts.push(
        `**H4**: ${!significant(raw, minutes) && derivedEarly ? 'CONFIRMED' : 'NOT confirmed'} — raw WebM has ${gaps} audio PTS gaps (Σ ${f(rawPrimary.audio.gapMs)} ms), raw b = ${fitText(raw)}; MP4 b = ${fitText(best(mp4))}, M4A b = ${fitText(best(m4a))} ms/min.`
      )
    }
  }

  lines.push(...verdicts.map((v) => (v.startsWith('  -') ? v : `- ${v}`)))
  lines.push('')
  return lines.join('\n')
}

const targets = (dirs.length ? dirs.map((d) => path.resolve(d)) : existsSync(RESULTS_ROOT)
  ? readdirSync(RESULTS_ROOT).map((d) => path.join(RESULTS_ROOT, d))
  : []
).filter((d) => statSync(d).isDirectory() && existsSync(path.join(d, 'measurement.json')))

if (targets.length === 0) {
  console.error(`av-drift-report: no arm with a measurement.json under ${dirs.length ? dirs.join(', ') : RESULTS_ROOT}`)
  process.exit(1)
}

const report = [
  `## ESCAPECRAFT / ESCAPEARTIST A/V drift — ${new Date().toISOString()}`,
  '',
  `A/V offset is positive when audio lags its picture. **a / b (timecode)**: per beep, the wall time of the picture on screen at the beep's file time (decoded from the frame timecode) minus the beep's own wall time — the primary measure and the one the verdicts read. Flash pairs: beep onset − flash onset, the brief's method, kept as a cross-check (flash onsets by ${flashMethod}, luma threshold ${LUMA_THRESHOLD}; an onset more than ${f(MAX_ONSET_GAP_S * 1000, 0)} ms after the previous decoded frame is "uncertain" and left out). b is ms per minute of take. "Grid b" is one track's onsets against the ${PERIOD_S} s wall-clock schedule; "video vs wall b" is every timecoded frame's paint time − file time. Significant: |b| > 3 SE and more than one frame (${f(FRAME_MS)} ms) over the take.`,
  '',
  ...targets.map(analyseArm),
].join('\n')
console.log(report)
if (existsSync(RESULTS_ROOT) && targets.every((t) => path.dirname(t) === RESULTS_ROOT)) {
  writeFileSync(path.join(RESULTS_ROOT, 'report.md'), report)
}
