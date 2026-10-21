// A 32-bit float PCM WAV built from the channels a test supplies.
//
// mediabunny reads PCM without WebCodecs, so in jsdom a WAV is the one
// container the streamed waveform path (ESCSUITE-338) decodes for real. Float
// samples come back bit for bit, which lets a test hand the same channels to
// the AudioContext double and compare the two paths' peaks exactly.

/** Interleave `channels` (all the same length) into a WAVE_FORMAT_IEEE_FLOAT file. */
export function floatWav(channels: Float32Array[], sampleRate = 48000): ArrayBuffer {
  const frames = channels[0]?.length ?? 0
  const count = channels.length
  const dataBytes = frames * count * 4
  const view = new DataView(new ArrayBuffer(44 + dataBytes))
  const ascii = (at: number, text: string) =>
    [...text].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)))
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  ascii(8, 'WAVEfmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 3, true) // WAVE_FORMAT_IEEE_FLOAT
  view.setUint16(22, count, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * count * 4, true)
  view.setUint16(32, count * 4, true)
  view.setUint16(34, 32, true)
  ascii(36, 'data')
  view.setUint32(40, dataBytes, true)
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < count; c++) view.setFloat32(44 + (i * count + c) * 4, channels[c][i], true)
  }
  return view.buffer
}
