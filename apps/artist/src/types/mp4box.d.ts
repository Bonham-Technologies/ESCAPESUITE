/**
 * Type definitions for mp4box.js
 * Based on https://github.com/nicksrandall/mp4box-types and mp4box documentation
 */

declare module 'mp4box' {
  export interface MP4MediaTrack {
    id: number;
    created: Date;
    modified: Date;
    movie_duration: number;
    movie_timescale: number;
    layer: number;
    alternate_group: number;
    volume: number;
    track_width: number;
    track_height: number;
    timescale: number;
    duration: number;
    bitrate: number;
    codec: string;
    language: string;
    nb_samples: number;
    /** The tkhd display matrix: nine fixed-point values, a b u c d v x y w. */
    matrix: Int32Array | Uint32Array | number[];
    /** The edit list (elst) entries, when the track has one. */
    edits?: Array<{
      segment_duration: number;
      media_time: number;
      media_rate_integer: number;
      media_rate_fraction: number;
    }>;
  }

  export interface MP4VideoTrack extends MP4MediaTrack {
    type: 'video';
    video: {
      width: number;
      height: number;
    };
  }

  export interface MP4AudioTrack extends MP4MediaTrack {
    type: 'audio';
    audio: {
      sample_rate: number;
      channel_count: number;
      sample_size: number;
    };
  }

  export type MP4Track = MP4VideoTrack | MP4AudioTrack;

  export interface MP4Info {
    duration: number;
    timescale: number;
    fragment_duration?: number;
    isFragmented: boolean;
    isProgressive: boolean;
    hasIOD: boolean;
    brands: string[];
    created: Date;
    modified: Date;
    tracks: MP4Track[];
    videoTracks: MP4VideoTrack[];
    audioTracks: MP4AudioTrack[];
  }

  export interface MP4Sample {
    number: number;
    track_id: number;
    timescale: number;
    description_index: number;
    description: {
      avcC?: ArrayBuffer;
      hvcC?: ArrayBuffer;
      vpcC?: ArrayBuffer;
      av1C?: ArrayBuffer;
    };
    data: Uint8Array;
    size: number;
    alreadyRead?: number;
    duration: number;
    cts: number;
    dts: number;
    is_sync: boolean;
    is_leading: number;
    depends_on: number;
    is_depended_on: number;
    has_redundancy: number;
    degradation_priority: number;
    offset: number;
  }

  export interface MP4ArrayBuffer extends ArrayBuffer {
    fileStart: number;
  }

  export interface ExtractionOptions {
    nbSamples?: number;
    rapAlignement?: boolean;
  }

  export interface MP4File {
    onMoovStart?: () => void;
    onReady?: (info: MP4Info) => void;
    onError?: (error: string) => void;
    onSamples?: (trackId: number, ref: unknown, samples: MP4Sample[]) => void;

    appendBuffer(buffer: MP4ArrayBuffer): number;
    start(): void;
    stop(): void;
    flush(): void;

    setExtractionOptions(
      trackId: number,
      user?: unknown,
      options?: ExtractionOptions
    ): void;

    unsetExtractionOptions(trackId: number): void;

    seek(time: number, useRap?: boolean): { offset: number; time: number };

    /** The track's `trak` box (not the summary in MP4Info), down to its sample descriptions. */
    getTrackById(trackId: number): MP4TrakBox;

    releaseUsedSamples(trackId: number, sampleNumber: number): void;

    getInfo(): MP4Info;
  }

  /** A box that can serialise itself, header included, into a DataStream. */
  export interface MP4WritableBox {
    write(stream: DataStream): void;
  }

  export interface MP4TrakBox {
    mdia: {
      minf: {
        stbl: {
          stsd: {
            entries: Array<{
              type: string;
              avcC?: MP4WritableBox;
              hvcC?: MP4WritableBox;
            }>;
          };
        };
      };
    };
  }

  export function createFile(): MP4File;

  export class DataStream {
    static readonly BIG_ENDIAN: boolean;
    constructor(buffer?: ArrayBuffer, byteOffset?: number, endianness?: boolean);
    buffer: ArrayBuffer;
    byteLength: number;
  }

  /**
   * Get codec string for VideoDecoder configuration
   */
  export function getCodecString(
    codecFamily: string,
    description?: ArrayBuffer
  ): string;
}
