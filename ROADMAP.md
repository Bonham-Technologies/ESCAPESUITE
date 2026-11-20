# Roadmap

What ESCAPE Suite is working on. It is written from the project's own tracker each week, so it
changes often. Nothing here is a promise of a date.

## Now

- ESCAPECRAFT: a take is kept on your device while it records, so a crash, a closed tab or a power cut no longer loses it; CRAFT offers it back next time.
- ESCAPEARTIST: translate captions on your device into a second caption track, for bilingual videos.
- ESCAPECRAFT and ESCAPEARTIST: ask the browser to keep your stored recordings and projects, and show whether it agreed.
- The hosted apps keep working with no connection after your first visit.
- The offline single-file downloads carry a Content-Security-Policy that blocks every network request, which you can check with view-source.
- Tighter checks on pull requests and workflows now the project is open source.

## Next

- ESCAPEARTIST: Remove silences no longer repeats a clip's transition at every cut, and refuses settings that would cut thousands of tiny pauses.
- ESCAPECRAFT: deleting a take asks first.
- ESCAPEARTIST: stopping a transcription keeps the captions heard so far, and a timeline edited during a run is flagged.
- ESCAPEARTIST: clip speed from 0.25x to 4x, "Zoom to region" that writes the zoom keyframes for you, and markers copied as YouTube chapters.
- ESCAPEARTIST: export and save straight to a file you choose, and keep the screen awake while exporting, transcribing or recording.
- Shortcut hints show ⌘ on a Mac.
- Steadier tests: every new browser test also runs in Firefox and Safari's engine before it merges, plus new checks for exported frames and VP9 colour.

## Recently shipped

- ESCAPEARTIST: Remove silences can move everything after each cut, warns about clips it leaves behind, ignores muted and hidden tracks, and lets you jump to and play a pause before cutting it.
- ESCAPEARTIST: on-device transcription lets you pick the spoken language, uses far less memory on long timelines, stops cleanly, and asks before replacing captions.
- ESCAPEARTIST: exports wait for the right frame after each seek, so a cut never shows the frame before it.
- ESCAPEARTIST: confirmation prompts use the app's own dialog, so they work inside sandboxed embeds.
- ESCAPECRAFT: the floating recorder controls show the countdown and announce recording state to screen readers.
- ESCAPEPLAN: unknown addresses get a real "not found" page, each page has its own title, and the sitemap is built from the page list.
- Each release now ships an SBOM with an attestation, alongside its SHA-256 checksums.
- The Privacy Policy describes exactly what the hosted site's analytics records.
