// Equality for SourceVideo records, used to tell a no-op re-add from a real one.

import type { SourceVideo, WaveformPeak } from './types';

// SourceVideo is flat scalars plus waveformData, an array of {min,max} pairs,
// so "the same media, unchanged" is decidable field by field without a deep
// clone. Used to tell a no-op re-add from one carrying newer metadata.
function sameWaveform(a: WaveformPeak[] | undefined, b: WaveformPeak[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((peak, i) => peak.min === b[i].min && peak.max === b[i].max);
}

function sameSourceVideo(a: SourceVideo, b: SourceVideo): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof SourceVideo>;
  for (const key of keys) {
    if (key === 'waveformData') continue;
    if (a[key] !== b[key]) return false;
  }
  return sameWaveform(a.waveformData, b.waveformData);
}

export { sameSourceVideo };
