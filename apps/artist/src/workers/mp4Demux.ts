/**
 * MP4 demuxing for the video decode worker.
 *
 * Split out of `decodeWorker.ts` so the container half of the worker — which
 * needs nothing but mp4box and an ArrayBuffer — can be exercised by vitest
 * against real MP4 bytes, instead of only inside a Web Worker.
 */

import {
  createFile,
  type MP4File,
  type MP4Info,
  type MP4Sample,
  type MP4ArrayBuffer,
  type MP4VideoTrack,
} from 'mp4box';

/**
 * Represents an indexed video sample for seeking
 */
export interface IndexedSample {
  number: number;
  timestamp: number; // in seconds
  duration: number; // in seconds
  offset: number;
  size: number;
  isKeyframe: boolean;
  data?: ArrayBuffer;
}

export interface DemuxedVideo {
  mp4File: MP4File;
  info: MP4Info;
  videoTrack: MP4VideoTrack;
  samples: IndexedSample[];
  keyframeSamples: IndexedSample[];
}

/**
 * Demux an in-memory MP4 and index the samples of its first video track.
 *
 * `onDemuxProgress` is called once samples start arriving.
 */
export async function demuxVideoTrack(
  data: ArrayBuffer,
  onDemuxProgress: () => void = () => {}
): Promise<DemuxedVideo> {
  // Create mp4box file instance
  const mp4File = createFile();
  const samples: IndexedSample[] = [];

  // Promise to wait for mp4box to be ready
  const infoPromise = new Promise<MP4Info>((resolve, reject) => {
    mp4File.onError = (error: string) => {
      reject(new Error(`MP4 parsing error: ${error}`));
    };

    mp4File.onReady = (info: MP4Info) => {
      resolve(info);
    };
  });

  // Promise to collect all samples
  let samplesCollected = false;
  const samplesPromise = new Promise<void>((resolve) => {
    mp4File.onSamples = (
      _trackId: number,
      _ref: unknown,
      receivedSamples: MP4Sample[]
    ) => {
      for (const sample of receivedSamples) {
        samples.push({
          number: sample.number,
          timestamp: sample.cts / sample.timescale,
          duration: sample.duration / sample.timescale,
          offset: sample.offset,
          size: sample.size,
          isKeyframe: sample.is_sync,
          data: sample.data,
        });
      }

      // Update progress based on samples received
      if (!samplesCollected) {
        onDemuxProgress();
      }
    };

    // We'll resolve this after processing is complete
    setTimeout(() => {
      samplesCollected = true;
      resolve();
    }, 100);
  });

  // Append the buffer with fileStart position
  const buffer = data as MP4ArrayBuffer;
  buffer.fileStart = 0;
  mp4File.appendBuffer(buffer);

  // Wait for info
  const info = await infoPromise;

  // Check for video tracks
  if (!info.videoTracks || info.videoTracks.length === 0) {
    throw new Error('No video tracks found in file');
  }

  const videoTrack = info.videoTracks[0];

  // Set up extraction for the video track
  mp4File.setExtractionOptions(videoTrack.id, undefined, {
    nbSamples: Infinity,
  });

  // Start extraction
  mp4File.start();

  // Wait a bit for samples to be extracted
  await samplesPromise;

  // Flush to get remaining samples
  mp4File.flush();

  // Wait a bit more for flush to complete
  await new Promise((resolve) => setTimeout(resolve, 50));

  // Sort samples by timestamp
  samples.sort((a, b) => a.timestamp - b.timestamp);

  // Build keyframe index
  const keyframeSamples = samples.filter((s) => s.isKeyframe);

  if (keyframeSamples.length === 0) {
    throw new Error('No keyframes found in video');
  }

  return { mp4File, info, videoTrack, samples, keyframeSamples };
}
