// The media the preview draws from: one object URL and one element per source.
//
// Every clip on the timeline points at a source blob in IndexedDB. Something
// has to turn those blobs into things a canvas can draw — a <video>, an <img>
// — and then take them away again when the clip that needed them goes. That
// bookkeeping is what lives here: load the blobs the timeline currently wants,
// reconcile one element per URL, and revoke every URL the timeline no longer
// asks for (and all of them on unmount, where a leak would outlive the editor).
//
// The elements are handed back as refs rather than state deliberately: the
// draw loop reads them sixty times a second, and a re-render per element
// change would be a render per loaded clip.
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useEditorStore } from '../../store/projectStore';
import { getVideoBlob } from '../../core/storage';

/** What the preview needs to draw and play the timeline's media. */
export interface PreviewMedia {
  /** One <video> per loaded video source, keyed by source id. */
  videoElementsRef: RefObject<Map<string, HTMLVideoElement>>;
  /** One <img> per loaded image source, keyed by source id. */
  imageElementsRef: RefObject<Map<string, HTMLImageElement>>;
  /** One <audio> per loaded audio-only source, keyed by source id. */
  audioElementsRef: RefObject<Map<string, HTMLAudioElement>>;
  /** True while blobs for newly referenced sources are still being fetched. */
  isLoading: boolean;
  /** Changes when the set of loaded video sources changes — a redraw cue. */
  videoUrlsKey: string;
  /** Changes when the set of loaded image sources changes — a redraw cue. */
  imageUrlsKey: string;
}

/**
 * Load, reconcile and release the preview's media elements.
 *
 * Reads the clips and source media straight from the editor store, so the
 * component that calls it needs to pass nothing and re-subscribes to nothing.
 */
export function usePreviewMedia(): PreviewMedia {
  const videoElementsRef = useRef<Map<string, HTMLVideoElement>>(new Map());
  const imageElementsRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const [videoUrls, setVideoUrls] = useState<Map<string, string>>(new Map());
  const [imageUrls, setImageUrls] = useState<Map<string, string>>(new Map());
  const [audioUrls, setAudioUrls] = useState<Map<string, string>>(new Map());
  const [isLoading, setIsLoading] = useState(false);

  const clips = useEditorStore((state) => state.project.timeline.clips);
  const tracks = useEditorStore((state) => state.project.timeline.tracks);
  const sourceVideos = useEditorStore((state) => state.sourceVideos);

  // Preload all videos, images, and audio
  // Create a stable dependency key that changes when clips or sourceVideos change
  const clipSourceIds = useMemo(() =>
    [...new Set(clips.map(c => c.sourceVideoId).filter(id => id))].sort().join(','),
    [clips]
  );
  const sourceVideoIds = useMemo(() =>
    sourceVideos.map(s => s.id).sort().join(','),
    [sourceVideos]
  );

  useEffect(() => {
    const loadAllMedia = async () => {
      const sourceIds = [...new Set(clips.map(c => c.sourceVideoId).filter(id => id))];
      const newVideoUrls = new Map<string, string>();
      const newImageUrls = new Map<string, string>();
      const newAudioUrls = new Map<string, string>();

      // Only show loading if we need to fetch new media
      const needsLoading = sourceIds.some(id => {
        const sourceMedia = sourceVideos.find(s => s.id === id);
        const isImage = sourceMedia?.mediaType === 'image';
        const isAudio = sourceMedia?.mediaType === 'audio';
        if (isImage) return !imageUrls.has(id);
        if (isAudio) return !audioUrls.has(id);
        return !videoUrls.has(id);
      });

      if (needsLoading) {
        setIsLoading(true);
      }

      for (const sourceId of sourceIds) {
        // Check media type
        const sourceMedia = sourceVideos.find(s => s.id === sourceId);
        const isImage = sourceMedia?.mediaType === 'image';
        const isAudio = sourceMedia?.mediaType === 'audio';

        if (isImage) {
          // Handle image
          if (imageUrls.has(sourceId)) {
            newImageUrls.set(sourceId, imageUrls.get(sourceId)!);
            continue;
          }
        } else if (isAudio) {
          // Handle audio
          if (audioUrls.has(sourceId)) {
            newAudioUrls.set(sourceId, audioUrls.get(sourceId)!);
            continue;
          }
        } else {
          // Handle video
          if (videoUrls.has(sourceId)) {
            newVideoUrls.set(sourceId, videoUrls.get(sourceId)!);
            continue;
          }
        }

        try {
          const blob = await getVideoBlob(sourceId);
          if (blob) {
            const url = URL.createObjectURL(blob);
            if (isImage) {
              newImageUrls.set(sourceId, url);
            } else if (isAudio) {
              newAudioUrls.set(sourceId, url);
            } else {
              newVideoUrls.set(sourceId, url);
            }
          }
        } catch (error) {
          console.error('Failed to load media:', error);
        }
      }

      // Cleanup old video URLs that are no longer needed
      videoUrls.forEach((url, id) => {
        if (!newVideoUrls.has(id)) {
          URL.revokeObjectURL(url);
        }
      });

      // Cleanup old image URLs
      imageUrls.forEach((url, id) => {
        if (!newImageUrls.has(id)) {
          URL.revokeObjectURL(url);
        }
      });

      // Cleanup old audio URLs
      audioUrls.forEach((url, id) => {
        if (!newAudioUrls.has(id)) {
          URL.revokeObjectURL(url);
        }
      });

      setVideoUrls(newVideoUrls);
      setImageUrls(newImageUrls);
      setAudioUrls(newAudioUrls);
      setIsLoading(false);
    };

    loadAllMedia();
  }, [clipSourceIds, sourceVideoIds]);

  // Create/update video elements
  useEffect(() => {
    const existingVideos = videoElementsRef.current;
    const newVideos = new Map<string, HTMLVideoElement>();

    videoUrls.forEach((url, sourceId) => {
      if (existingVideos.has(sourceId)) {
        newVideos.set(sourceId, existingVideos.get(sourceId)!);
      } else {
        const video = document.createElement('video');
        video.src = url;
        video.preload = 'auto';
        video.playsInline = true;
        video.muted = true; // Start muted, we'll unmute the active audio track
        video.crossOrigin = 'anonymous';
        newVideos.set(sourceId, video);
      }
    });

    existingVideos.forEach((video, id) => {
      if (!newVideos.has(id)) {
        video.pause();
        video.src = '';
      }
    });

    videoElementsRef.current = newVideos;

    // Canvas dimensions are now driven by project.resolution from the store
    // No need to derive from source video dimensions
  }, [videoUrls, sourceVideos, clips, tracks]);

  // Create/update image elements
  useEffect(() => {
    const existingImages = imageElementsRef.current;
    const newImages = new Map<string, HTMLImageElement>();

    imageUrls.forEach((url, sourceId) => {
      if (existingImages.has(sourceId)) {
        newImages.set(sourceId, existingImages.get(sourceId)!);
      } else {
        const img = document.createElement('img');
        img.src = url;
        img.crossOrigin = 'anonymous';
        newImages.set(sourceId, img);
      }
    });

    imageElementsRef.current = newImages;
  }, [imageUrls]);

  // Create/update audio elements
  useEffect(() => {
    const existingAudios = audioElementsRef.current;
    const newAudios = new Map<string, HTMLAudioElement>();

    audioUrls.forEach((url, sourceId) => {
      if (existingAudios.has(sourceId)) {
        newAudios.set(sourceId, existingAudios.get(sourceId)!);
      } else {
        const audio = document.createElement('audio');
        audio.src = url;
        audio.preload = 'auto';
        newAudios.set(sourceId, audio);
      }
    });

    // Pause and cleanup old audio elements
    existingAudios.forEach((audio, id) => {
      if (!newAudios.has(id)) {
        audio.pause();
        audio.src = '';
      }
    });

    audioElementsRef.current = newAudios;
  }, [audioUrls]);

  // Cleanup
  useEffect(() => {
    return () => {
      videoUrls.forEach(url => URL.revokeObjectURL(url));
      imageUrls.forEach(url => URL.revokeObjectURL(url));
      audioUrls.forEach(url => URL.revokeObjectURL(url));
      videoElementsRef.current.forEach(video => {
        video.pause();
        video.src = '';
      });
      audioElementsRef.current.forEach(audio => {
        audio.pause();
        audio.src = '';
      });
    };
  }, []);

  // Redraw cues for the render loop: which sources are loaded, not which URLs,
  // so a reload of the same set does not retrigger the redraw.
  const videoUrlsKey = useMemo(() => [...videoUrls.keys()].sort().join(','), [videoUrls]);
  const imageUrlsKey = useMemo(() => [...imageUrls.keys()].sort().join(','), [imageUrls]);

  return {
    videoElementsRef,
    imageElementsRef,
    audioElementsRef,
    isLoading,
    videoUrlsKey,
    imageUrlsKey,
  };
}
