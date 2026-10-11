---
'@escapesuite/artist': patch
---

An imported video whose first frames the browser decodes too late is no longer stored at a frame rate well below its own.

When the browser could not decode a high-bitrate VP9 video fast enough at the start of the import's frame-rate measurement, it threw some frames away without showing them, and the measurement counted only the frames it showed — so a 120 fps file could be stored as 83.33 or 76.09 fps and a 60 fps one as 41.92, and labelled as measured. The measurement now notices when frames were skipped this way, by comparing the gaps between the frames' own timestamps with the browser's count of frames shown, and by watching for decoded frames piling up unshown; when either says frames went missing it stores the default 30 fps, labelled as assumed, instead of a wrong number labelled as measured.
