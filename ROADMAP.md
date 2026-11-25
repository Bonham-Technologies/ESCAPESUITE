# Roadmap

What ESCAPE Suite is working on. It is written from the project's own tracker each week, so it
changes often. Nothing here is a promise of a date.

## Now

- ESCAPEARTIST in Firefox: recordings made in Chrome show their true colours instead of slightly shifted ones.
- ESCAPEARTIST: an MP4 export of a slowed clip no longer repeats frames when the source's frame rate wasn't measured (Firefox and Safari imports).
- The offline single-file downloads carry a Content-Security-Policy that blocks every network request, which you can check with view-source.
- The Privacy Policy says exactly when the offline build fetches anything (only a video address you give it) and how long analytics data is kept.

## Next

- ESCAPEARTIST: "Export Section" after speeding up a clip exports the right range, or explains why it can't, instead of a blank file.
- ESCAPEARTIST: changing a clip's speed tells you which captions and markers it left behind, as Remove silences does, and screen readers hear when a speed is refused.
- The release notes name one address, escapesuite.tech.
- Steadier tests: browser tests for splitting, trimming, undoing and saving sped-up clips, and a heading-order fix in ESCAPEARTIST's inspector.

## Recently shipped

- ESCAPECRAFT: a take is kept on your device while it records, so a crash, a closed tab or a power cut no longer loses it; CRAFT offers it back next time. Deleting a take now asks first.
- ESCAPEARTIST: clip speed from 0.25x to 4x, "Zoom to region" that writes the zoom keyframes for you, and timeline markers copied as YouTube chapters.
- ESCAPEARTIST: export and save straight to a file you choose, with clearer "Export WebM…" buttons and a missing-media check before the save dialog.
- ESCAPEARTIST: translate captions on your device into a second caption track, for bilingual videos.
- ESCAPECRAFT and ESCAPEARTIST: the browser is asked to keep your stored recordings and projects, and the screen stays awake while exporting, transcribing or recording.
- The hosted apps keep working with no connection after your first visit.
- ESCAPEARTIST: fixes for repeated transitions after Remove silences or Split, repeated frames in 30 fps WebM exports and slowed clips, cancelled exports, and captions when a transcription is stopped or the timeline changes mid-run.
- Shortcut hints show ⌘ on a Mac; Firefox recordings carry the right colour labels.
- The site moved to escapesuite.tech and the hub was rebuilt on the Bonham Technologies design system; old escapesuite.io links forward.
- Every new browser test now also runs in Firefox and Safari's engine before it merges.
