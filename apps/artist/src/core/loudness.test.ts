// ITU-R BS.1770-4 / EBU R128 loudness metering and the export's
// normalise-to-target (ESCSUITE-292).
//
// Every expected loudness below is derived analytically in this file, not read
// back from the implementation: the K-weighting magnitude at 1 kHz is computed
// from the coefficient table printed in BS.1770-4 itself (48 kHz), and each
// fixture's gating arithmetic is written out beside it. Tolerance is the
// ticket's ±0.1 LU throughout.
import { describe, it, expect } from 'vitest'
import {
  LOUDNESS_TARGETS,
  MAX_GAIN_DB,
  TRUE_PEAK_CEILING_DBTP,
  applyGainWithLimiter,
  applyInterleavedGainWithLimiter,
  exportLoudness,
  formatLoudnessSummary,
  gainForTarget,
  kWeightingCoefficients,
  loudnessTargetOrOff,
  measureInterleavedLoudness,
  measureLoudness,
} from './loudness'

const SR = 48000

// BS.1770-4, Table 1 (stage 1, the shelving pre-filter) and Table 2 (stage 2,
// the RLB high-pass), both at 48 kHz.
const TABLE = {
  pre: { b0: 1.53512485958697, b1: -2.69169618940638, b2: 1.19839281085285, a1: -1.69065929318241, a2: 0.73248077421585 },
  rlb: { b0: 1.0, b1: -2.0, b2: 1.0, a1: -1.99004745483398, a2: 0.99007225036621 },
}

/** |H(e^jw)|^2 of one biquad, straight from its coefficients. */
function biquadPower(c: typeof TABLE.pre, freq: number, sr: number): number {
  const w = (2 * Math.PI * freq) / sr
  const re = (b0: number, b1: number, b2: number) => b0 + b1 * Math.cos(w) + b2 * Math.cos(2 * w)
  const im = (b1: number, b2: number) => -(b1 * Math.sin(w) + b2 * Math.sin(2 * w))
  const num = re(c.b0, c.b1, c.b2) ** 2 + im(c.b1, c.b2) ** 2
  const den = re(1, c.a1, c.a2) ** 2 + im(c.a1, c.a2) ** 2
  return num / den
}

/** The K-weighting power gain at 1 kHz, from the published table: ≈ +0.70 dB. */
const KW_1K = biquadPower(TABLE.pre, 1000, SR) * biquadPower(TABLE.rlb, 1000, SR)

/** Loudness of a mono sine of peak amplitude `a` at 1 kHz: −0.691 + 10·log10(a²/2 · Kw). */
const monoSineLufs = (a: number) => -0.691 + 10 * Math.log10(((a * a) / 2) * KW_1K)

/** The amplitude whose mono 1 kHz sine is exactly `lufs`, by inverting the line above. */
const amplitudeForMonoLufs = (lufs: number) => Math.sqrt((2 * 10 ** ((lufs + 0.691) / 10)) / KW_1K)

/** `seconds` of a 1 kHz sine at peak amplitude `a`. 48 samples per cycle, so whole cycles per 100 ms. */
function sine(seconds: number, a: number, freq = 1000, sr = SR, phase = 0): Float32Array {
  const n = Math.round(seconds * sr)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = a * Math.sin((2 * Math.PI * freq * i) / sr + phase)
  return out
}

function concat(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((s, p) => s + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

function interleave(l: Float32Array, r: Float32Array): Float32Array {
  const out = new Float32Array(l.length * 2)
  for (let i = 0; i < l.length; i++) {
    out[2 * i] = l[i]
    out[2 * i + 1] = r[i]
  }
  return out
}

const dbfs = (db: number) => 10 ** (db / 20)
const peakOf = (x: Float32Array) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0)

describe('kWeightingCoefficients', () => {
  it('reproduces the BS.1770-4 coefficient table at 48 kHz', () => {
    const { pre, rlb } = kWeightingCoefficients(48000)
    for (const key of ['b0', 'b1', 'b2', 'a1', 'a2'] as const) {
      expect(pre[key]).toBeCloseTo(TABLE.pre[key], 8)
      expect(rlb[key]).toBeCloseTo(TABLE.rlb[key], 8)
    }
  })

  it('keeps the same response at another sample rate (derived, not tabled)', () => {
    // The analytic 1 kHz gain at 48 kHz is ≈ +0.70 dB — the −0.691 offset
    // cancels it to within 0.01 dB, which is why a stereo 1 kHz sine at
    // −23 dBFS reads −23.0 LUFS. A coefficient set derived for 44.1 kHz must
    // land on the same gain there.
    const { pre, rlb } = kWeightingCoefficients(44100)
    const gainDb = 10 * Math.log10(biquadPower(pre, 1000, 44100) * biquadPower(rlb, 1000, 44100))
    expect(gainDb).toBeCloseTo(10 * Math.log10(KW_1K), 2)
    expect(10 * Math.log10(KW_1K)).toBeCloseTo(0.7, 1)
  })
})

describe('measureLoudness', () => {
  it('measures a mono 1 kHz sine built to be −23 LUFS as −23 LUFS', () => {
    const a = amplitudeForMonoLufs(-23)
    // ≈ −19.99 dBFS peak: a full-scale mono sine is ≈ −3.01 LUFS.
    expect(20 * Math.log10(a)).toBeCloseTo(-23 + 3.01, 1)
    const m = measureLoudness([sine(10, a)], SR)
    expect(m.integratedLufs).toBeCloseTo(-23, 1)
    // 100 sub-blocks of 100 ms → 97 overlapping 400 ms blocks, all above both gates.
    expect(m.gatedBlocks).toBe(97)
  })

  it('weights each front channel 1.0, so stereo is the mono figure + 3.01 LU', () => {
    const x = sine(5, dbfs(-23))
    const mono = measureLoudness([x], SR).integratedLufs
    const stereo = measureLoudness([x, x], SR).integratedLufs
    expect(mono).toBeCloseTo(monoSineLufs(dbfs(-23)), 1)
    expect(stereo - mono).toBeCloseTo(10 * Math.log10(2), 2)
    // EBU Tech 3341 case 1: a stereo 1 kHz sine at −23 dBFS reads −23.0 LUFS.
    expect(stereo).toBeCloseTo(-23, 1)
  })

  it('weights the surrounds of a 5.0 layout 1.41 and drops the LFE of a 5.1 one', () => {
    const x = sine(5, dbfs(-30))
    const z = new Float32Array(x.length)
    const front = measureLoudness([x, z, z, z, z], SR).integratedLufs
    const surround = measureLoudness([z, z, z, x, z], SR).integratedLufs
    expect(surround - front).toBeCloseTo(10 * Math.log10(1.41), 3)
    const lfe = measureLoudness([z, z, z, x, z, z], SR)
    expect(lfe.integratedLufs).toBe(-Infinity)
    const surround51 = measureLoudness([z, z, z, z, x, z], SR).integratedLufs
    expect(surround51 - front).toBeCloseTo(10 * Math.log10(1.41), 3)
  })

  it('gates out a silent half: only the blocks that hold signal count', () => {
    // 10 s at −23 then 10 s of digital silence. Sub-blocks 0–99 are the sine,
    // 100–199 silence. Blocks j = 0…196; j ≤ 96 are all sine, j = 97/98/99
    // hold 3/4, 2/4 and 1/4 of it (−24.25, −26.0, −29.0 LUFS — all above the
    // relative gate of −23 + 10·log10(0.985) − 10 ≈ −33.07), and j ≥ 100 are
    // silence, refused by the −70 LUFS absolute gate. So 100 blocks count and
    // the mean energy is (97 + 3/4 + 2/4 + 1/4) / 100 = 0.985 of the sine's:
    // integrated = −23 + 10·log10(0.985) = −23.066 LUFS.
    const a = amplitudeForMonoLufs(-23)
    const m = measureLoudness([concat(sine(10, a), new Float32Array(10 * SR))], SR)
    expect(m.integratedLufs).toBeCloseTo(-23 + 10 * Math.log10(0.985), 1)
    expect(Math.abs(m.integratedLufs - (-23 + 10 * Math.log10(0.985)))).toBeLessThan(0.01)
    expect(m.gatedBlocks).toBe(100)
  })

  it('drops quiet sections below the relative gate (EBU Tech 3341 case 3)', () => {
    // Stereo −36 / −23 / −36 dBFS for 10 / 60 / 10 s. Per-block energy
    // relative to the −23 section: quiet q = 10^(−13/10) = 0.0501, loud 1.
    // 797 blocks: 194 all-quiet, 597 all-loud, and three transition blocks at
    // each edge, (3q+1)/4, (2q+2)/4, (q+3)/4. Absolute-gated mean
    // (600 + 197q)/797 → relative gate ≈ −34.16 LUFS, so the 194 quiet blocks
    // (−36) fail it and the six transitions pass. Gated mean
    // (600 + 3q)/603 = 0.99527 → −23 + 10·log10(0.99527) = −23.021 LUFS
    // (Tech 3341 publishes −23.0 ± 0.1).
    const l = concat(sine(10, dbfs(-36)), sine(60, dbfs(-23)), sine(10, dbfs(-36)))
    const m = measureLoudness([l, l], SR)
    const q = 10 ** (-13 / 10)
    const expected = -23 + 10 * Math.log10((600 + 3 * q) / 603)
    expect(m.integratedLufs).toBeCloseTo(-23, 1)
    expect(Math.abs(m.integratedLufs - expected)).toBeLessThan(0.02)
    expect(m.gatedBlocks).toBe(603)
  })

  it('sets the relative gate from the mean of the blocks that passed the absolute gate, not of every block', () => {
    // Stereo 1 kHz: 10 s at −23 dBFS, 10 s at −36, then 80 s of digital
    // silence. Relative to the loud section, quiet blocks carry q = 10^(−1.3)
    // = 0.0501 of its energy. The 997 blocks are 97 loud, 3 loud→quiet
    // transitions ((3+q)/4, (2+2q)/4, (1+3q)/4), 97 quiet, 3 quiet→silence
    // (3q/4, 2q/4, q/4) and 797 of silence. The absolute gate keeps the 200
    // that hold any signal; their mean ≈ (100.5 + 100.5q)/200 puts the relative
    // gate ≈ −35.8 LUFS, so the −36 blocks and the quiet→silence transitions
    // fail it. 100 blocks count: (97 + (6 + 6q)/4)/100 = (98.5 + 1.5q)/100 of
    // the loud section's energy. A gate taken from the mean of *all* 997
    // blocks would sit near −42.8, let the −36 section in, and read −25.85
    // over 200 blocks.
    const q = 10 ** (-13 / 10)
    const l = concat(sine(10, dbfs(-23)), sine(10, dbfs(-36)), new Float32Array(80 * SR))
    const m = measureLoudness([l, l], SR)
    const loudSection = -0.691 + 10 * Math.log10(2 * (dbfs(-23) ** 2 / 2) * KW_1K)
    const expected = loudSection + 10 * Math.log10((98.5 + 1.5 * q) / 100)
    expect(Math.abs(m.integratedLufs - expected)).toBeLessThan(0.01)
    expect(m.gatedBlocks).toBe(100)
  })

  it('reports −Infinity and no gated blocks for silence, for a signal under −70 LUFS, and for less than one block', () => {
    expect(measureLoudness([new Float32Array(SR), new Float32Array(SR)], SR)).toEqual({
      integratedLufs: -Infinity,
      truePeakDbtp: -Infinity,
      gatedBlocks: 0,
    })
    const quiet = measureLoudness([sine(2, dbfs(-80))], SR)
    expect(quiet.integratedLufs).toBe(-Infinity)
    expect(quiet.gatedBlocks).toBe(0)
    expect(quiet.truePeakDbtp).toBeCloseTo(-80, 1)
    // 300 ms: three sub-blocks, not one whole 400 ms block.
    expect(measureLoudness([sine(0.3, dbfs(-10))], SR).integratedLufs).toBe(-Infinity)
    expect(measureLoudness([], SR).integratedLufs).toBe(-Infinity)
  })

  it('measures at 44.1 kHz too', () => {
    // EBU Tech 3341 runs its sine cases at 997 Hz for 44.1 kHz.
    const x = sine(10, dbfs(-23), 997, 44100)
    expect(measureLoudness([x, x], 44100).integratedLufs).toBeCloseTo(-23, 1)
  })

  it('reads the true peak of a tone between its samples, to the Tech 3341 tolerance', () => {
    // An fs/4 sine at 45°: every sample is ±0.707, the waveform peaks at 1.0.
    // Tech 3341 allows +0.2 / −0.4 dB on a true-peak reading.
    const x = sine(1, 1, SR / 4, SR, Math.PI / 4)
    expect(peakOf(x)).toBeCloseTo(Math.SQRT1_2, 5)
    const tp = measureLoudness([x], SR).truePeakDbtp
    expect(tp).toBeGreaterThan(-0.4)
    expect(tp).toBeLessThan(0.2)
    // A 997 Hz tone at −6 dBFS peaks at −6 dBTP.
    expect(measureLoudness([sine(1, dbfs(-6), 997)], SR).truePeakDbtp).toBeCloseTo(-6, 1)
  })

  it('reads full-band noise close to a long band-limited reference, as ffmpeg does', () => {
    // White noise carries energy right up to Nyquist, where a short
    // interpolator under-reads the peaks between samples. The reference here
    // is the same 4× read through a 128-tap-per-phase windowed sinc. Measured
    // 2026-10-16 on this seeded noise: 16 taps per phase read 1.11 dB under
    // it, 24 taps 0.68 dB under. (On ffmpeg's own noise source the 24-tap
    // read and ebur128's agree to 0.03 dB.)
    let seed = 7
    const x = new Float32Array(SR)
    for (let i = 0; i < x.length; i++) {
      seed = (seed * 16807) % 2147483647
      x[i] = seed / 2147483647 - 0.5
    }
    const half = 64
    let reference = 0
    for (let n = half; n < x.length - half; n++) {
      reference = Math.max(reference, Math.abs(x[n]))
      for (const f of [0.25, 0.5, 0.75]) {
        let sum = 0
        let norm = 0
        for (let i = -half + 1; i <= half; i++) {
          const u = f - i
          const tap = (Math.sin(Math.PI * u) / (Math.PI * u)) * (0.5 + 0.5 * Math.cos((Math.PI * u) / half))
          sum += tap * x[n + i]
          norm += tap
        }
        reference = Math.max(reference, Math.abs(sum / norm))
      }
    }
    const tp = measureLoudness([x], SR).truePeakDbtp
    const referenceDb = 20 * Math.log10(reference)
    expect(tp).toBeGreaterThan(referenceDb - 0.8)
    expect(tp).toBeLessThan(referenceDb + 0.2)
  })

  it('puts a full-scale clipped square wave above 0 dBTP', () => {
    // Every sample is ±1.0 (0 dBFS), but the band-limited waveform those
    // samples describe overshoots each edge (Gibbs): the true peak is above
    // the sample peak.
    const x = new Float32Array(SR)
    for (let i = 0; i < x.length; i++) x[i] = i % 48 < 24 ? 1 : -1
    const m = measureLoudness([x, x], SR)
    expect(peakOf(x)).toBe(1)
    expect(m.truePeakDbtp).toBeGreaterThan(0.5)
    expect(m.truePeakDbtp).toBeLessThan(3)
  })

  it('gives the same answer for an interleaved buffer as for its planar channels', () => {
    const l = concat(sine(3, dbfs(-18)), sine(2, dbfs(-40)))
    const r = sine(5, dbfs(-25), 440)
    expect(measureInterleavedLoudness(interleave(l, r), 2, SR)).toEqual(measureLoudness([l, r], SR))
  })
})

describe('gainForTarget', () => {
  it('moves the integrated loudness onto the target when the true peak stays under the ceiling', () => {
    expect(gainForTarget({ integratedLufs: -30, truePeakDbtp: -10, gatedBlocks: 1 }, -23, -1)).toEqual({
      gainDb: 7,
      limited: false,
    })
    // Exactly at the ceiling is not over it.
    expect(gainForTarget({ integratedLufs: -30, truePeakDbtp: -8, gatedBlocks: 1 }, -23, -1).limited).toBe(false)
  })

  it('says the limiter will engage when the gained true peak would pass the ceiling', () => {
    expect(gainForTarget({ integratedLufs: -30, truePeakDbtp: -3, gatedBlocks: 1 }, -23, -1)).toEqual({
      gainDb: 7,
      limited: true,
    })
  })

  it('caps a boost at +20 dB, and judges the ceiling on the capped gain', () => {
    expect(MAX_GAIN_DB).toBe(20)
    // −50 → −14 would be +36 dB: room tone and hum brought up with it.
    expect(gainForTarget({ integratedLufs: -50, truePeakDbtp: -40, gatedBlocks: 1 }, -14, -1)).toEqual({
      gainDb: 20,
      limited: false,
    })
    // −15 + 20 = +5 dBTP: over the ceiling on the gain actually applied.
    expect(gainForTarget({ integratedLufs: -50, truePeakDbtp: -15, gatedBlocks: 1 }, -14, -1)).toEqual({
      gainDb: 20,
      limited: true,
    })
  })

  it('asks for no gain on a programme with no measurable loudness', () => {
    expect(gainForTarget({ integratedLufs: -Infinity, truePeakDbtp: -Infinity, gatedBlocks: 0 }, -14, -1)).toEqual({
      gainDb: 0,
      limited: false,
    })
  })
})

describe('applyGainWithLimiter', () => {
  it('is a plain gain when the result stays under the ceiling', () => {
    const l = sine(2, dbfs(-20))
    const r = sine(2, dbfs(-26), 440)
    const lOut = l.slice()
    const rOut = r.slice()
    applyGainWithLimiter([lOut, rOut], 6, -1)
    const g = dbfs(6)
    for (let i = 0; i < l.length; i += 97) {
      expect(lOut[i]).toBeCloseTo(l[i] * g, 6)
      expect(rOut[i]).toBeCloseTo(r[i] * g, 6)
    }
  })

  it('holds a gain that would clip to the −1 dBTP ceiling, and the loudness rises with it', () => {
    // A −20 dBFS stereo sine asked for +25 dB would peak at +5 dBFS.
    const x = sine(3, dbfs(-20))
    const before = measureLoudness([x, x], SR)
    const l = x.slice()
    const r = x.slice()
    applyGainWithLimiter([l, r], 25, TRUE_PEAK_CEILING_DBTP)
    const ceiling = dbfs(TRUE_PEAK_CEILING_DBTP)
    // The sample peak is held exactly; the true peak to within 0.1 dB.
    expect(peakOf(l)).toBeLessThanOrEqual(ceiling + 1e-6)
    const after = measureLoudness([l, r], SR)
    expect(after.truePeakDbtp).toBeLessThanOrEqual(TRUE_PEAK_CEILING_DBTP + 0.1)
    // A held sine is still a sine at the ceiling: ≈ −1 dBFS stereo → ≈ −1 LUFS,
    // nowhere near the +5 the gain alone would have made, but 19 LU louder.
    expect(after.integratedLufs).toBeGreaterThan(before.integratedLufs + 18)
    expect(after.integratedLufs).toBeLessThan(TRUE_PEAK_CEILING_DBTP + 0.2)
    // Both channels carry the same gain (the limiter is linked).
    expect(Array.from(r)).toEqual(Array.from(l))
  })

  it('pulls a programme that already passes the ceiling down to it at 0 dB gain', () => {
    const sq = new Float32Array(SR)
    for (let i = 0; i < sq.length; i++) sq[i] = i % 48 < 24 ? 1 : -1
    applyGainWithLimiter([sq], 0, -1)
    expect(peakOf(sq)).toBeLessThanOrEqual(dbfs(-1) + 1e-6)
    expect(measureLoudness([sq], SR).truePeakDbtp).toBeLessThanOrEqual(-1 + 0.1)
  })

  it('lets go after a transient instead of holding the reduction for the rest of the programme', () => {
    // A 50 ms burst at 0 dBFS, then 1 s at −20 dBFS. Asked for 0 dB gain with a
    // −6 dBTP ceiling, the burst is limited and the quiet tail (−20 < −6) is
    // handed back untouched once the hold and release have run.
    const x = concat(sine(0.05, 1), sine(1, dbfs(-20)))
    const out = x.slice()
    applyGainWithLimiter([out], 0, -6)
    expect(peakOf(out.subarray(0, 0.05 * SR))).toBeLessThanOrEqual(dbfs(-6) + 1e-6)
    const tail = 0.75 * SR
    for (let i = tail; i < out.length; i += 101) {
      expect(out[i]).toBeCloseTo(x[i], 4)
    }
  })

  it('links the channels: a loud right channel holds a quiet left one down with it, and neither passes the ceiling', () => {
    // L a 1 kHz tone at 0.05, R a 3 kHz tone at 0.5, asked for +12 dB under
    // −1 dBTP. R would peak at +6 dBFS; a detector that read only L would let
    // it through. Linked, both channels take one gain at every sample.
    const l = sine(1, 0.05)
    const r = sine(1, 0.5, 3000)
    const lOut = l.slice()
    const rOut = r.slice()
    applyGainWithLimiter([lOut, rOut], 12, -1)
    const ceiling = dbfs(-1)
    expect(peakOf(lOut)).toBeLessThanOrEqual(ceiling + 1e-6)
    expect(peakOf(rOut)).toBeLessThanOrEqual(ceiling + 1e-6)
    for (let i = 0; i < l.length; i++) {
      if (Math.abs(l[i]) > 1e-3 && Math.abs(r[i]) > 1e-3) {
        expect(Math.abs(lOut[i] / l[i] - rOut[i] / r[i])).toBeLessThan(1e-5)
      }
    }
  })

  describe('hold and release', () => {
    // A steady 0.1 (−20 dBFS) with one sample at 1.0 at frame 1000, through a
    // −6 dBTP ceiling at 0 dB gain. The spike needs 10^(−6/20) = 0.501187; the
    // bed alone needs nothing. Measured 2026-10-16 on the real limiter.
    const spike = () => {
      const x = new Float32Array(SR).fill(0.1)
      x[1000] = 1
      return x
    }
    const ratio = (out: Float32Array, n: number) => out[n] / 0.1

    it('holds the reduction for 5 ms after the last frame that needed it', () => {
      const out = spike()
      applyGainWithLimiter([out], 0, -6)
      expect(out[1000]).toBeCloseTo(dbfs(-6), 6)
      // 240 frames = 5 ms at 48 kHz: held exactly through 1240…
      for (const n of [1100, 1200, 1240]) expect(ratio(out, n)).toBeCloseTo(dbfs(-6), 6)
      // …and letting go from 1241.
      expect(ratio(out, 1241)).toBeGreaterThan(dbfs(-6) + 1e-5)
      expect(ratio(out, 1241)).toBeLessThan(0.502)
    })

    it('then releases with a 50 ms time constant', () => {
      const out = spike()
      applyGainWithLimiter([out], 0, -6)
      // One and three time constants (2400 and 7200 frames) after the hold:
      // 1 − (1 − 0.501187)·e^(−1) = 0.8165 and 1 − 0.498813·e^(−3) = 0.9752.
      expect(ratio(out, 1240 + 2400)).toBeCloseTo(1 - (1 - dbfs(-6)) * Math.exp(-1), 3)
      expect(ratio(out, 1240 + 7200)).toBeCloseTo(1 - (1 - dbfs(-6)) * Math.exp(-3), 3)
    })

    it('scales the hold and the release with the sample rate', () => {
      // At 44.1 kHz, 5 ms is round(220.5) = 221 frames and 50 ms is 2205.
      const out = spike()
      applyGainWithLimiter([out], 0, -6, 44100)
      expect(ratio(out, 1221)).toBeCloseTo(dbfs(-6), 6)
      expect(ratio(out, 1222)).toBeGreaterThan(dbfs(-6) + 1e-5)
      expect(ratio(out, 1221 + 2205)).toBeCloseTo(1 - (1 - dbfs(-6)) * Math.exp(-1), 3)
      // The interleaved twin takes the rate the same way.
      const inter = spike()
      applyInterleavedGainWithLimiter(inter, 1, 0, -6, 44100)
      expect(Array.from(inter)).toEqual(Array.from(out))
    })
  })

  it('treats an interleaved buffer the way it treats its planar channels', () => {
    const l = concat(sine(0.5, 1), sine(0.5, dbfs(-30)))
    const r = sine(1, dbfs(-9), 440)
    const planarL = l.slice()
    const planarR = r.slice()
    applyGainWithLimiter([planarL, planarR], 3, -1)
    const inter = interleave(l, r)
    applyInterleavedGainWithLimiter(inter, 2, 3, -1)
    expect(Array.from(inter)).toEqual(Array.from(interleave(planarL, planarR)))
  })
})

describe('loudnessTargetOrOff', () => {
  it('accepts exactly the three offered targets and turns anything else into off', () => {
    expect(LOUDNESS_TARGETS).toEqual([-14, -16, -23])
    for (const t of LOUDNESS_TARGETS) expect(loudnessTargetOrOff(t)).toBe(t)
    for (const bad of [undefined, null, -20, '-14', 14, NaN]) expect(loudnessTargetOrOff(bad)).toBeUndefined()
  })
})

describe('exportLoudness', () => {
  const stereo = (x: Float32Array) => interleave(x, x)

  it('has nothing to say about a mix that is absent or silent', () => {
    expect(exportLoudness(null, 2, SR, -14)).toBeUndefined()
    expect(exportLoudness(new Float32Array(2 * SR), 2, SR, -14)).toBeUndefined()
  })

  it('measures without touching the mix when no target is set', () => {
    const mix = stereo(sine(3, dbfs(-30)))
    const copy = mix.slice()
    const result = exportLoudness(mix, 2, SR, undefined)
    expect(result).toEqual({
      measuredLufs: expect.closeTo(-30, 1),
      truePeakDbtp: expect.closeTo(-30, 1),
      gainDb: 0,
      targetLufs: null,
      limited: false,
    })
    expect(Array.from(mix)).toEqual(Array.from(copy))
  })

  it('normalises the mix in place onto the target, under the ceiling', () => {
    const mix = stereo(sine(3, dbfs(-30)))
    const before = mix.slice()
    const result = exportLoudness(mix, 2, SR, -16)!
    // Under the ceiling the limiter cannot engage, so this is a plain gain.
    const g = 10 ** (result.gainDb / 20)
    for (let i = 0; i < mix.length; i += 89) expect(mix[i]).toBeCloseTo(before[i] * g, 6)
    expect(result.targetLufs).toBe(-16)
    expect(result.gainDb).toBeCloseTo(14, 1)
    expect(result.limited).toBe(false)
    expect(measureInterleavedLoudness(mix, 2, SR).integratedLufs).toBeCloseTo(-16, 1)
  })

  it('reports the limiter when the target asks for more than the ceiling allows', () => {
    // A stereo sine reads at its own peak level, so −20 → −14 LUFS lifts its
    // peak to −14 dBTP: well under the ceiling, no limiting.
    expect(exportLoudness(stereo(sine(3, dbfs(-20))), 2, SR, -14)!.limited).toBe(false)
    // The same quiet tone with one 0.9 click: the loudness barely moves
    // (≈ −30 LUFS) but the true peak is ≈ −0.9 dBTP, so the +16 dB the target
    // needs would put it at ≈ +15 dBTP — the limiter has to hold it.
    const x = sine(3, dbfs(-30))
    x[SR] = 0.9
    const mix = stereo(x)
    const result = exportLoudness(mix, 2, SR, -14)!
    expect(result.gainDb).toBeCloseTo(16, 0)
    expect(result.limited).toBe(true)
    const after = measureInterleavedLoudness(mix, 2, SR)
    expect(after.truePeakDbtp).toBeLessThanOrEqual(TRUE_PEAK_CEILING_DBTP + 0.1)
    // The tone itself is untouched by the limiter away from the click, so the
    // programme still lands on the target.
    expect(after.integratedLufs).toBeCloseTo(-14, 0)
  })

  it('applies, and reports, no more than the capped boost to a very quiet mix', () => {
    const mix = stereo(sine(3, dbfs(-60)))
    const before = mix.slice()
    const result = exportLoudness(mix, 2, SR, -14)!
    expect(result.gainDb).toBe(MAX_GAIN_DB)
    for (let i = 0; i < mix.length; i += 89) expect(mix[i]).toBeCloseTo(before[i] * 10, 6)
    expect(measureInterleavedLoudness(mix, 2, SR).integratedLufs).toBeCloseTo(-40, 1)
  })

  it('treats a stale or unknown target as off', () => {
    const mix = stereo(sine(3, dbfs(-30)))
    expect(exportLoudness(mix, 2, SR, -20)?.targetLufs).toBeNull()
  })
})

describe('formatLoudnessSummary', () => {
  const base = { measuredLufs: -18.34, truePeakDbtp: -4, gainDb: 0, targetLufs: null, limited: false }

  it('says only the measurement when normalising is off', () => {
    expect(formatLoudnessSummary(base)).toBe('Measured −18.3 LUFS')
  })

  it('adds the signed gain when a target was applied', () => {
    expect(formatLoudnessSummary({ ...base, gainDb: 4.34, targetLufs: -14 })).toBe('Measured −18.3 LUFS · gain +4.3 dB')
    expect(formatLoudnessSummary({ ...base, measuredLufs: -11.96, gainDb: -2.04, targetLufs: -14 })).toBe(
      'Measured −12.0 LUFS · gain −2.0 dB'
    )
    // A gain that rounds to zero is +0.0, never −0.0.
    expect(formatLoudnessSummary({ ...base, measuredLufs: -13.98, gainDb: -0.02, targetLufs: -14 })).toBe(
      'Measured −14.0 LUFS · gain +0.0 dB'
    )
  })

  it('says what the limiter did when it engaged', () => {
    expect(formatLoudnessSummary({ ...base, gainDb: 4.34, targetLufs: -14, limited: true })).toBe(
      'Measured −18.3 LUFS · gain +4.3 dB · the limiter held the peaks, so the mix lands below the target'
    )
  })

  it('prints a loudness above 0 LUFS without a sign', () => {
    expect(formatLoudnessSummary({ ...base, measuredLufs: 1.04 })).toBe('Measured 1.0 LUFS')
  })
})
