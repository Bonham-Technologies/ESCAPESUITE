# Changelog

## 2.11.4

### Patch Changes

- c955081: Undo now steps back a whole gesture everywhere it should. Trimming a clip's edge on
  the timeline is one undo step instead of one per frame of the drag, so a single
  Ctrl+Z puts the clip's in and out points back where they were before you grabbed
  the handle — with the ripple tool included, where that same Ctrl+Z also puts the
  clips it pushed out of the way back, instead of needing a second one. The Animation and Transition Out duration sliders coalesce the same
  way, joining the position, scale, opacity, blur, mask and stroke sliders. And
  resetting an overlay's transform from the Transform section header is one step
  rather than two, so one Ctrl+Z restores both the transform and the overlay's own
  position instead of leaving it half-reset.
  
  Undo history is 50 entries deep, and a drag that filled it with intermediate
  values used to evict everything you had done before it — that no longer happens
  from any slider or from a trim.

## 2.11.2

### Patch Changes

- d2b1115: Dragging a slider in the clip inspector is now one undo step.
  
  Position, scale, opacity, blur, corner radius, stroke width and a shape overlay's size,
  rotation, blur, stroke and fill opacity each wrote to the undo stack on every step of the drag — a blur drag alone was around a hundred entries, which is twice the
  whole history stack — so one drag threw away everything you had done before it and Ctrl+Z
  stepped back half a pixel at a time. A drag now records a single entry, taken before the drag
  starts, so one undo puts the slider back where it was.

## 2.11.1

### Patch Changes

- 1a09367: **A masked clip now looks masked on the timeline.** A video or image clip shows a small picture
  of itself at its left edge, clipped to whatever shape you gave the clip — so a clip you made
  circular is a circle on the timeline, not a rectangle you have to remember is a circle. It
  follows the mask: change the shape or take it off and the clip on the timeline changes with it.
  A webcam clip handed over from ESCAPECRAFT arrives showing the circle it was recorded in.
  
  Two things it deliberately does not do. The clip's **border** is not drawn on the timeline
  picture — the picture is there to show the shape, and the border is in the frame. And the
  **selection box in the preview stays a rectangle**: a circular clip is still selected, moved and
  resized by the box around it, which is the handle you already know. The thumbnail in your media
  library is unchanged too, because that one belongs to the file rather than to one clip of it, and
  two clips of the same file can have different shapes.
  
  One other visible change came with it, on audio clips. Making room for the picture meant giving
  the clip's content box a position of its own, and that reversed a paint order that had been the
  wrong way round: a clip's name and duration now draw **over** its waveform instead of under it.
  Small, and arguably how it should always have looked, but it is a difference you can see.

## 2.11.0

### Minor Changes

- 9a4b7ca: **Any video or image clip can now be masked to a circle or a rounded rectangle, and given a
  border.** Select a clip and open the new **Mask & Stroke** section of the inspector: pick a
  shape, set how round the corners are, and set the border's width and colour. Both show up
  everywhere the clip does — in the preview, in an exported MP4 or WebM, and through a
  transition — because they are drawn by the one renderer all of those share.
  
  **A webcam clip handed over from ESCAPECRAFT now arrives with its circle and its white
  border.** Before this release, "Record webcam as a separate track" gave you the camera in the
  right corner at the right size but as a bare rectangle, so the clip on the timeline did not
  look like the recording you had just watched. It does now — and because the shape and the
  border are ordinary clip properties, you can change either one, or take them off.
  
  Two details worth knowing. The corner radius is a proportion of the clip rather than a number
  of pixels, so the corners stay as round as you set them whatever the project's resolution;
  the border's width is a proportion of the frame, so it scales with the frame rather than
  staying a fixed pixel count. And neither can be animated: a mask that changed shape halfway
  through a clip is not a thing this release does.
  
  The mask and the border are drawn on the clip's picture only. The selection box and the click
  target in the preview stay rectangular; the timeline shows no picture of a clip yet, masked or
  otherwise; and the thumbnail in your media library — which belongs to the source file rather
  than to any one clip of it — is unmasked.

## 2.10.5

### Patch Changes

- 2ffd080: Two fixes to the audio parts of an ESCAPECRAFT take (ESCSUITE-71).
  
  **An audio part handed over from ESCAPECRAFT now shows its waveform on the timeline.** The
  media library draws one for every file you import, audio and video alike, but a take arriving
  from ESCAPECRAFT's "Send to Editor" skipped that step — so its microphone and system-audio
  tracks sat on the timeline as bare rectangles, and the screen recording's own mixed audio had
  no waveform either. Nothing else ever filled them in: the waveform is computed once, when the
  media arrives, so a handed-over part simply never had one. Every part of a handed-over take now
  arrives with the same waveform the library's own import computes. A part ESCAPECRAFT
  recorded with no audio in it is left alone rather than decoded, a take recorded in a quiet
  room keeps the "has audio" flag ESCAPECRAFT saved for it, and a waveform that cannot be read
  costs that part its waveform and nothing else — the take is still imported and still placed.
  
  **Audio clips explicitly carry no picture transform.** An audio part has no picture, so the
  position, scale and rotation an imported clip gets are meaningless for one — it is never
  drawn. That was already what happened, but only as a side effect of an audio part being
  stored with no width or height: the same accident meant that, had the parts of a take ever
  been handed over in a different order, the webcam's corner would have been measured against a
  part with no picture and the camera would have landed in the wrong place on any recording
  smaller than the project. Both are now stated: an audio clip takes the documented default
  transform, and the rectangle the camera's corner is measured in is the take's picture.

## 2.10.2

### Patch Changes

- c6f3f52: Two fixes to the ESCAPECRAFT take handoff (ESCSUITE-69).
  
  **The webcam's corner inset on a recording narrower than 1280 px.**
  `overlayPlacementToTransform` read the compositor's 20 px inset as 20/1280 of the frame at
  every width, on the assumption that the preview canvas is always capped at 1280. It is
  capped only *above* 1280 and a narrower share is never scaled up, so a 640-wide screen
  share was previewed — and composited into a downloaded MP4 — with a flat 20 px, while
  ESCAPEARTIST imported the camera 10 px from the edge: half as far. `overlayMarginFor` now
  mirrors ESCAPECRAFT's `overlayPaddingFor` term for term. Takes recorded at 1280 or wider
  are unaffected, because at or above the cap the two readings agree.
  
  **A take is skipped if any of its parts is already in the media library.** The guard asked
  about the take's primary part alone, so deleting the primary from the library and re-sending
  the take from ESCAPECRAFT placed the webcam part on the timeline a second time (re-adding it
  to the library was already idempotent by id). The question is now asked about every part of
  the take, and asked before the first part is written — and asked a second time when the take
  is actually placed, against the timeline, because a take handed over while the "Resume
  Previous Session?" prompt is up reads the library before restoring has filled it.

## 2.8.0

### Minor Changes

- 6c1f64b: A recording sent from ESCAPECRAFT now lands **on the timeline**, not just in the media
  library — and a recording made with "Record webcam as a separate track" arrives as the two
  clips it really is, the screen and the camera, on two tracks.
  
  **This changes what a single-file handoff does too.** "Send to Editor" used to add the
  recording to the media library and leave the timeline empty for you to drag it onto; it now
  places it for you. The whole take is one undo step, so a single Ctrl+Z takes it back off the
  timeline and leaves the media in your library. A handoff into an editor that already holds
  work **appends at the end** of the timeline rather than landing on top of it.
  
  For a take recorded as separate tracks, the webcam clip arrives in the corner and at the size
  it was recorded in — and, unlike the composited recording, you can now move it, resize it,
  animate it or delete it. Its rounded/circular *shape* is not carried over yet; that is
  coming with the clip mask that will apply to every clip, not only this one.
  
  If the editor offers to resume a previous session while a recording is arriving, the
  recording waits: it joins your media library straight away, and goes on the timeline once you
  have answered — after the restored clips if you resume, at the start if you do not. Either
  way it is still the one undo step.
  
  If a part of a take is missing from storage — cleared, deleted by hand, or unreadable — the
  rest still arrives and the editor says how many parts were skipped instead of reporting a
  clean success. A part recorded by a newer ESCAPECRAFT than this editor knows about is added to
  your media library, where you can see and delete it, rather than placed somewhere arbitrary.
  
  Loading media from a URL (`?video=` and the host's `LOAD_VIDEO` message) is unchanged: those
  still add to the library and place nothing.

## 2.7.0

### Patch Changes

- Updated dependencies [7ce6894]
  - @escapesuite/shared@1.4.0

## 2.6.4

### Patch Changes

- fd97804: Fixed the resolution picker, the export dialog's dropdowns and the keyframe panel's easing
  select losing arrow-key presses to the playhead. With one of those dropdowns focused,
  ArrowLeft/ArrowRight now change the selected option as expected instead of stepping the
  transport backward or forward a frame.

## 2.6.3

### Patch Changes

- 609489f: Two dialog fixes in the editor.
  
  **The resolution-change confirm is a real modal (ESCSUITE-64).** `ResolutionPicker`'s
  "Change Resolution" overlay had no `role`, no accessible name, no focus trap, no Escape and
  no place in `App`'s `modalOpen` — Tab walked out behind it and Delete, Space and Ctrl+Z all
  still reached the editor. It now uses the same shared `useDialogBehaviour` the editor's other
  four modals use, titles itself with an `<h2>`, takes the `--accent-on-fill` contrast fix its
  primary button needed, cancels on Escape, and reports its open state up to `App` so the editor
  behind it takes no key while it is up.
  
  **One project-load dialog (ESCSUITE-63).** Dropping a `.veditor` on the media library opened a
  second, duplicate "Load Project" dialog that `modalOpen` knew nothing about, so Ctrl+O stacked
  `App`'s copy on top of it — two dialogs, two focus traps, duplicate ids. The uploader now hands
  the file to `useProjectActions`, which owns the one dialog: the drop path gains the loading
  overlay and the "Project loaded successfully" / "Failed to load project" notices the File-menu
  path always had, its save-and-load answer now reports the save — and a failed save — instead of
  swallowing it to the console, and it loses the blocking `alert()` it used to report an unreadable
  file with. That last one is the only change of the four that costs a user anything: the notice is
  one slot on a three-second timer, where an `alert` demanded acknowledgement.

## 2.6.2

### Patch Changes

- 98d1776: The editor's three untrapped overlays adopt the shared dialog hook.
  
  The shortcut sheet, the project-load safety dialog and the "Resume Previous Session?"
  prompt looked modal but trapped no focus: Tab walked straight out of each of them into
  the editor behind, and only the sheet answered Escape at all. All three now use
  `useDialogBehaviour` from `@escapesuite/shared/hooks`, the same way `ExportDialog` does —
  `role="dialog"`, `aria-modal`, `aria-labelledby` its own heading, initial focus inside,
  a Tab/Shift+Tab cycle that cannot leave, and focus restored to the opener on close.
  
  Escape's meaning is decided per overlay, not inherited: the sheet closes (as it always
  did, now through the hook rather than a second `window` listener, so there is one Escape
  path); the project-load dialog cancels, the only one of its three answers that leaves the
  timeline alone; and the session prompt **swallows** Escape — declining calls
  `clearSessionState()`, so a dismissal key must not reach it. The prompt stays up with
  focus trapped, and the two buttons remain the only ways out.
  
  The keyframe graph could previously be nudged, extended and deleted from behind any dialog,
  because it is focusable, its handler is element-level rather than gated on the editor's modal
  flag, and the keyframe panel painted *over* every modal's backdrop — so a click went through
  the dialog and into the graph. The traps close the Tab route; the panel moving to a new
  `--z-panel` layer, below the modals, closes the pointer route.
  
  Three smaller things the overlays' new accessibility audits found. The shortcut sheet's
  scrolling body was unreachable by keyboard and now carries `tabIndex={0}`, so a keyboard user
  can scroll it. The "Save & Load" and "Restore Session" buttons take the palette's dark ink on
  their blue fill, where white only reached 2.75:1 — those two labels change colour. And both
  dialogs' titles move from `<h3>` to `<h2>`, which skipped a heading level under the page's
  `<h1>`; nothing about them renders differently.

## 2.6.1

### Patch Changes

- 29e4fbd: Global keyboard shortcuts stop while a modal is open. With the export dialog, the shortcut
  sheet, the "Resume Previous Session?" prompt or the project-load safety dialog in front of the
  editor, Space no longer starts playback, Delete no longer removes the selected clip and Ctrl+Z
  no longer undoes. Both of the app's window listeners — the shortcut cascade and the transport's
  — now take a `modalOpen` gate, and the shortcut sheet binds its own Escape, `?` and Shift+`/`
  so it still closes on a key.

## 2.5.2

### Patch Changes

- 65438d0: Detach a video frame source's `onloadeddata` and `onerror` before disposing it. `create()` left
  both attached for the element's whole life, and `dispose()` empties `src` — which the browser
  answers with an `error` event, handing it to a handler that revoked an already-revoked object
  URL and rejected a long-settled promise. Both were no-ops, so nothing misbehaved; but it is the
  same shape as the ESCAPECRAFT cleanup that spun error → cleanup → error for the life of the
  page, one edit away from doing the same thing here.

## 2.5.1

### Patch Changes

- b622314: Recover the duration of a headerless audio file on import. An ESCAPECRAFT take
  recorded with no camera is raw MediaRecorder Opus in a WebM with no Duration
  element, and the audio importer trusted the `Infinity` (or `0`) the browser
  reported, building an infinitely long audio clip. It now runs the same
  seek-to-end probe the video importer has used since the last release — one
  shared implementation, so the two cannot drift apart.

## 2.5.0

### Patch Changes

- 9f4241d: WebM files with no duration header — raw MediaRecorder output, or an ESCAPECRAFT take whose metadata fix failed — used to hang forever on import, stuck on "Processing…": the editor believed the `Infinity` the browser reported and then asked for a thumbnail at `Infinity × 0.1`, a seek a browser refuses. They now import with their real length, recovered by seeking to the end of the file, and say so plainly if it cannot be found. The same recovery covers recordings opened from ESCAPECRAFT by link.

## 2.4.2

### Patch Changes

- Updated dependencies [3b0fe5f]
  - @escapesuite/shared@1.3.3

## 2.3.11

### Patch Changes

- 236a7dc: Export dialog: Shift+Tab can no longer move focus out of the dialog.
- Updated dependencies [236a7dc]
  - @escapesuite/shared@1.3.2

## 2.3.10

### Patch Changes

- Updated dependencies [50491ce]
  - @escapesuite/shared@1.3.1

## 2.3.7

### Patch Changes

- e567d5b: Dragging a clip or overlay in the preview is one undo step, with or without the keyframe panel open; with the panel open, a drag no longer fills the undo history. Undoing a drag now also puts the clip back where it started — it previously landed on the position the drag had just produced, because the entry was recorded on release rather than before the first move.

## 2.3.6

### Patch Changes

- b014350: Headless render bundle: worker scripts are inlined again under Vite 8.3 (the kit could not start its decode/export workers from file://)
- 77c4a08: Holding an arrow key to nudge a keyframe now undoes as a single step, instead of filling the undo history with one entry per key repeat.

## 2.3.5

### Patch Changes

- b86b523: Keyframe graph: Delete and Escape now behave consistently after an undo, a right-click delete or a property switch, clicking a preset no longer leaves another keyframe selected, and switching clip or property starts the graph fresh; screen readers announce repeated identical edits instead of falling silent on the second one; Enter takes the curve's value at the exact time the new keyframe lands on.

## 2.3.4

### Patch Changes

- 6ad5ca0: Internal: the editor store is composed from focused slices — project, tracks, clips, keyframes, overlays, selection, playback, markers, UI and history — with no behaviour change.

## 2.3.3

### Patch Changes

- cb61bb2: The keyframe graph is now fully keyboard-operable: Tab into it, move between keyframes with the arrow keys, nudge a keyframe's time and value, add one at the playhead with Enter, and delete with Delete. Screen readers announce each keyframe's time, value and easing. Fixes a bug (ESCSUITE-49) where pressing Delete with a keyframe selected deleted the whole clip.

## 2.3.2

### Patch Changes

- 16a84e4: Editing the timeline does less work per pointer move: a clip drag spends about a fifth less JavaScript per pointer frame and a rubber-band selection about half, measured, because the track headers and the ruler no longer redraw on every frame of a gesture and a drag now measures the track area, binds its listeners and builds its snap points once when you press the mouse instead of on every move. The clip inspector and the toolbar no longer re-render on every playback tick, so playback leaves more of the main thread free — only the Split button now follows the playhead, and only when its enabled state actually changes.

## 2.3.1

### Patch Changes

- f46d27a: Moving a track down no longer loses it when the track cannot be found; a second status message now gets its own three seconds instead of being blanked early by the previous one's timer, and a pending message no longer fires after the editor closes; the clip inspector no longer shows a transition-duration slider for a clip that has no transition, and choosing a transition type for such a clip now keeps the default half-second duration instead of leaving it unset; clicking the timeline's track area on an empty project now moves the playhead where you clicked, as the ruler already did; and a recording opened from ESCAPECRAFT no longer leaks its thumbnail's object URL.

## 2.3.0

### Minor Changes

- 5301287: Each keyframe's easing can now be chosen in the keyframe panel: select a keyframe in the curve view and pick its easing from the same seven curves the animate-in/out presets offer. Previously every keyframe you created was locked to Ease In-Out.

### Patch Changes

- e30d359: A project carrying overlays from an older ARTIST version now brings them onto the timeline as ordinary overlay clips when it loads, so they can be selected, restyled, moved, trimmed and deleted — and, for the first time, they are included in exports and headless renders instead of being silently dropped. One visible change comes with that: a blur region from an older version, which used to draw nothing at all, now blurs the video underneath it.
- 87230b7: Internal: the unreachable overlay editor and the old inline keyframe editor are removed, along with the legacy overlay store actions, selection state and preview draw loops they were the last readers of. Legacy overlays in old project files still load — they become ordinary overlay clips.

## 2.2.10

### Patch Changes

- 5cd981b: Internal: the editor shell is split into focused modules — the chrome as components, the theme, session, autosave, shortcut, resize and host-integration concerns as hooks — with no behaviour change.

## 2.2.8

### Patch Changes

- b5a4f5f: Split the clip inspector into focused modules — one component per section, the value maths as pure functions, and the store wiring in a hook — with no behaviour change.

## 2.2.7

### Patch Changes

- 0dc5a1f: Internal: the timeline editor is split into focused modules; no behaviour change.

## 2.2.6

### Patch Changes

- 988986e: Rotating an overlay in the preview now follows the pointer exactly on non-square projects; previously the angle was measured in stretched canvas space

## 2.2.5

### Patch Changes

- a71c87d: Preview playback does far less work per frame: the preview canvas is rasterised at its displayed size (a 4K project now plays at full frame rate instead of ~12 fps), the timecode and timeline playhead no longer re-render the editor each tick, and scrubbing with several clips on one source no longer composites twice.
  
  The picture-in-picture compositor no longer restores its canvas state twice per frame.

## 2.2.4

### Patch Changes

- 39a8f27: - A transition with media on only one side now runs as the transition it is: a wipe clips that side to the region it should occupy and a slide moves it, instead of every type fading.
  - A dissolve blurs in the preview the way it already did in an export, so what you see on the canvas is what the exported file contains.
  - The inspector no longer reads an opaque fill whose colour happens to end in `00` — pure red `#ff0000`, black `#000000` — as "no fill": the fill button, the colour picker and the fill-opacity slider all go by the colour's alpha channel now.
  - A clip whose media has not loaded no longer takes transform handles or counts as a video in the preview.
  - A recording that is cancelled stays cancelled: a recorder that flushes its last chunk after you cancel no longer saves that take to the library.

## 2.2.3

### Patch Changes

- 357163b: Bugs found and fixed while breaking the preview up into testable pieces:
  
  - A shape overlay filled with a six-digit colour ending in `00` — pure red, green, yellow or black — was drawn with no fill at all, in the preview and in exports alike.
  - The preview now releases the object URLs for its loaded media when it unmounts instead of holding them for the life of the document (a hygiene fix; the editor's preview never unmounts while the tab is open).

## 2.2.2

### Patch Changes

- 38d540f: Follow-up fixes from the coverage program:
  
  ESCAPECRAFT:
  
  - Closing or navigating away from the recorder mid-countdown or mid-take left the countdown and duration timers ticking and the screen, webcam and microphone still live; everything is now released as the recorder goes away.
  
  ESCAPEARTIST:
  
  - Ctrl/Cmd + "=" and Ctrl/Cmd + "-" zoomed the timeline and swallowed the browser's own page zoom; they now reach the browser, while plain "+", "=" and "-" still zoom the timeline.
  - Re-adding media the library already holds, unchanged — as a restored session does — recorded an undo step that undid nothing.

## 2.2.1

### Patch Changes

- f2b1be4: Bugs found and fixed while bringing both apps under a coverage floor:
  
  ESCAPECRAFT:
  
  - A recording whose thumbnail could not be extracted in time leaked the blob URL it had opened.
  - Converting a recording with an already-cancelled export hung instead of stopping straight away.
  - Cancelling a conversion between its two passes left the video and audio encoders open.
  - A compositor overlay with zero padding was given the default padding instead.
  - The screen and webcam capture stayed live after a take ended, so the browser kept showing "sharing" and the camera light stayed on.
  - The microphone stayed live after a take ended, for the same reason.
  - Disposing a recorder stopped nothing, leaving its combined stream running.
  
  ESCAPEARTIST:
  
  - Starting a new project left the previous project's markers on the timeline.
  - MP4 exports played a wipe-up transition as a wipe-down and vice versa; they now match the preview.
  - Cancelling an export while it was muxing was ignored, and the export finished anyway.
  - Ctrl+B never split the selected clip, and Ctrl+V changed the active tool instead of pasting.
  - Dragging a left, right, top or bottom resize handle in the preview resized both axes at once instead of the one being dragged.
  - Restoring a session could list the same media twice in the library.

## 2.2.0

### Minor Changes

- 90969e4: Host embedding protocol for apps running inside another page (#320):
  
  - ARTIST posts `EXPORT_COMPLETE { blob, format, name }` to the parent window after a successful export (the download still happens).
  - CRAFT's "Send to Editor" posts `SEND_TO_EDITOR { id }` to the parent when embedded instead of opening `/artist/`; the host navigates to its own editor URL with `?loadVideo=<id>`. Existing embedders must listen for this message.
  - ARTIST URL parameters: `?suppressRestore=1` (no "Resume Previous Session?" prompt, and no session autosave in that session), `?title=<name>` (initial project name), `?hostOrigin=<origin>` (postMessage target and inbound origin filter; recommended for production hosts).
  - ARTIST ignores inbound messages that do not come from its parent window; the `GET_STATE` reply now returns live state.
  - The hosted deployment (escapesuite.io) now sends `Content-Security-Policy: frame-ancestors 'self'` (#321).

### Patch Changes

- Updated dependencies [90969e4]
  - @escapesuite/shared@1.3.0

## 2.1.0

### Minor Changes

- b9f8928: - Moved CI to a Node 24 baseline and cleared the outstanding `fast-uri` security advisories via a pnpm override.
  - MP4 export now works correctly above 1080p, falling back to H.264 Level 5.1 for 4K/1440p sources; headless render metadata is now accurate, and missing source files fail loudly instead of silently producing a broken export.
  - Shipped headless render bundle v2: sources stream in via file input and results stream out via download, with metadata probing for accurate render info.
  - Accessibility fixes across ESCAPECRAFT and ESCAPEARTIST, plus new demo media in the README.

### Patch Changes

- Updated dependencies [b9f8928]
  - @escapesuite/shared@1.2.1

## 2.0.0

### Major Changes

- ESCAPEARTIST is now free and open source under the MIT license.

  **Breaking changes:**

  - Removed all licensing, subscription, and account gating. There is no sign-in,
    no trial, no plan check — the full timeline editor, overlays, keyframes, and
    both export formats are available to everyone.
  - Removed export watermarks. MP4 and WebM exports are unbranded regardless of
    how the app is run.
  - Removed the license-key entry flow from the offline build. The standalone
    single-file build now runs with no key and no activation step.

  **Distribution:**

  - Offline single-file builds are attached directly to each GitHub Release,
    replacing the gated download portal. Grab `ESCAPEARTIST-2.0.0.html` from the
    latest release and open it on any machine — including air-gapped networks.

## 1.3.0

### Minor Changes

- 36edd68: Add export cancellation support with AbortController

  - Cancel button now properly stops in-progress exports instead of just hiding the dialog
  - Export functions accept optional AbortSignal parameter
  - Resources (video elements, blob URLs, encoders) are properly cleaned up on cancellation
  - No error message shown for user-initiated cancellation

## 1.2.0

### Minor Changes

- Add resizable timeline, export performance improvements, and responsive inspector

  - **Resizable Timeline Panel**: Drag handle to adjust timeline height (120-600px), double-click to reset, persisted to localStorage
  - **Export Performance**: Real-time playback instead of frame-by-frame seeking, encoder backpressure to prevent memory exhaustion
  - **Responsive Inspector**: Collapsible panel with slide-out on mobile, floating toggle button
  - **Animation Caching**: Memoized keyframe interpolation (10,000 entry cache)
  - **Seek Optimization**: Skip redundant video seeks within frame tolerance
  - **Waveform Visibility**: White color when clip selected for better contrast
  - **Black Flash Prevention**: Event-based frame readiness waiting before encoding

- Add audio volume keyframe animation support

  - Volume property now animatable with keyframes like other properties
  - Keyframes applied continuously during playback and export
  - Supports all easing functions (linear, ease-in, ease-out, etc.)
  - Volume range 0-200% (0 = mute, 100% = original, 200% = 2x gain)

- Add standalone licensing system with pre-licensed downloads

  ### ESCAPEPLAN

  - **Pre-Licensed Downloads**: Server-side license injection - users download HTML with license already embedded
  - **Downloads Page**: "Download (Pre-Licensed)" button for instant-use downloads, "Generic" for manual key entry
  - **Edge Functions**: `get-licensed-download` for personalized builds, `get-user-licenses` for portal, `send-license-email` for purchase emails
  - **Database Migrations**: `license_activations` table, `downloads` storage bucket

  ### ESCAPECRAFT & ESCAPEARTIST

  - **License Input Modal**: Runtime license key entry UI for standalone builds
  - **Machine Hash**: Browser fingerprinting for activation tracking
  - **Dashboard Link**: Hidden in standalone mode (no dashboard exists)
  - **Analytics**: Removed from standalone builds (runs offline)

  ### Shared Package

  - **LicenseInputModal**: Reusable license entry component
  - **machineHash**: Cross-browser machine identification
  - **Bootstrap**: Analytics excluded from standalone mode

### Patch Changes

- Updated dependencies
  - @escapesuite/shared@1.2.0

## 1.1.1

### Patch Changes

- 0020d0e: Extract analytics trackEvent to @escapesuite/shared package

  - Add @escapesuite/shared/analytics module with shared trackEvent function
  - All apps now import trackEvent from shared package
  - App-specific analytics events remain in each app

- 246a63c: Extract auth UI components (AuthGate, ErrorScreen, LoadingScreen) to shared package

  - Move AuthGate, ErrorScreen, LoadingScreen components to @escapesuite/shared/auth
  - AuthGate now accepts appName, logo, and product props for customization
  - LoadingScreen accepts appName and logo props for app-specific branding
  - Apps use thin wrapper components that provide app-specific defaults
  - Removes ~240 lines of duplicated code across craft and artist

- 8c64a95: Extract auth utilities to @escapesuite/shared package

  - Add @escapesuite/shared/auth module with:
    - Config utilities (BUILD_MODE, isSaaSMode, isStandaloneMode)
    - AuthContext and useAuth hook
    - License validation with product parameter
    - Subscription API client
  - craft/artist now import from shared package

- dc3194d: Add app bootstrap utility for consistent initialization

  - Add `@escapesuite/shared/bootstrap` with `bootstrapApp()` function
  - Handles SaaS vs Standalone mode detection and auth wrapping
  - Dynamic loading of Clerk and Sentry (excludes from standalone bundle)
  - Simplifies main.tsx in craft and artist from ~53 lines to ~14 lines

- d5477d3: Extract Sentry configuration to @escapesuite/shared package

  - Add @escapesuite/shared/sentry module with shared initSentry function
  - Support product tagging via options parameter
  - All apps now import from shared package with app-specific product tags

- 08422a9: Extract IndexedDB storage operations to @escapesuite/shared package

  - Add @escapesuite/shared/storage module with:
    - Shared database configuration (DB_NAME, DB_VERSION)
    - Common video/thumbnail operations
    - Settings operations
    - Storage utilities
  - craft/artist now import from shared package
  - App-specific operations remain in each app

- 27869d5: Extract theme system to @escapesuite/shared package

  - Add @escapesuite/shared/theme module with storage-agnostic theme utilities
  - Add ThemeToggle component to shared package
  - All apps now use the shared theme module with app-specific storage adapters
  - Reduces ~500 lines of duplicated theme code

- 4fb6bd3: Extract shared types to @escapesuite/shared package

  - Add @escapesuite/shared/types module with:
    - MediaType, MediaSource types
    - WaveformPeak interface
    - SourceVideo interface
  - craft/artist now import shared types from shared package

- 33adadf: Extract time utilities and watermark module to shared package

  - Add @escapesuite/shared/utils with time formatting functions (formatTimecode, formatTime, formatDuration, parseTimecode, etc.)
  - Add @escapesuite/shared/watermark with drawWatermark function and StreamWatermarker class
  - Apps now re-export from shared, reducing duplication
  - Removes ~200 lines of duplicated code

- Updated dependencies [0020d0e]
- Updated dependencies [246a63c]
- Updated dependencies [8c64a95]
- Updated dependencies [dc3194d]
- Updated dependencies [d5477d3]
- Updated dependencies [08422a9]
- Updated dependencies [27869d5]
- Updated dependencies [4fb6bd3]
- Updated dependencies [33adadf]
  - @escapesuite/shared@1.1.0

## 1.1.0

### Minor Changes

- b633d3e: Add Changesets for version and release management

  - Automated version bumping and changelog generation
  - GitHub Action creates "Version Packages" PR when changesets accumulate
  - All main apps (plan, craft, artist) version together

### Patch Changes

- 0b2af1f: Dependency cleanup and version synchronization

  - Remove unused gh-pages dependency and deploy scripts from PLAN
  - Sync @clerk/clerk-react to ^5.59.2 across all apps
  - Sync React to ^19.2.3 across all apps
  - Standardize TypeScript constraint to ~5.9.3 (patch-only updates)

All notable changes to ESCAPEARTIST are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [1.4.0](https://github.com/bonham-technologies/ESCAPESUITE/compare/v1.3.0...v1.4.0) (2026-01-05)

### Features

- add Clerk auth integration and trial watermarks ([101edea](https://github.com/bonham-technologies/ESCAPESUITE/commit/101edea5dee3b9e4c116a7ebd9e9598ed8921a4a))
- add Clerk auth integration and trial watermarks ([7882e85](https://github.com/bonham-technologies/ESCAPESUITE/commit/7882e85d9b6986b28fd3f064cf2b2bccd72d2e68))
- add ESCAPECRAFT recorder integration ([dc321ad](https://github.com/bonham-technologies/ESCAPESUITE/commit/dc321ad4c397ecf7cab5a1a47a73ad9de2264103))
- add ESCAPECRAFT recorder integration ([6b08bbd](https://github.com/bonham-technologies/ESCAPESUITE/commit/6b08bbdc7e64442f7f27b8fa3a3338f24a0e7f26))
- add storage management - clear unused media and frame cache ([0f46b30](https://github.com/bonham-technologies/ESCAPESUITE/commit/0f46b303907bbf467cecb65f46c87e01a78c6ebc))
- integrate frame cache for instant scrubbing ([a38cba9](https://github.com/bonham-technologies/ESCAPESUITE/commit/a38cba99e156b5868b414e0cc3309abb8f37d017))
- integrate frame cache for instant scrubbing ([81754b6](https://github.com/bonham-technologies/ESCAPESUITE/commit/81754b6f1d5cad2611738f49dee183cc27c4d1a1))
- replace hand tool with ripple edit tool ([66e64f8](https://github.com/bonham-technologies/ESCAPESUITE/commit/66e64f8d649ad79ef3968e50bc50893c95d0f30b))
- replace hand tool with ripple edit tool ([2071f11](https://github.com/bonham-technologies/ESCAPESUITE/commit/2071f11dd105fa5a9a790ad579b70974fac5027d))

### Bug Fixes

- add dashboard navigation link in header ([b0b9d02](https://github.com/bonham-technologies/ESCAPESUITE/commit/b0b9d02c8496da50aa5bf1e7ec2bfcc9b20064d2))
- razor tool cuts at correct position after first split ([06b34b8](https://github.com/bonham-technologies/ESCAPESUITE/commit/06b34b82ec06794d4d00d9977c3d8ca3df0aeb11))
- resolve lint errors in AuthGate.tsx ([f5a4fbb](https://github.com/bonham-technologies/ESCAPESUITE/commit/f5a4fbbd15b8d77de6d2a90ead8fbe490e89af40))
- show Clear All button based on actual storage usage ([99beeaf](https://github.com/bonham-technologies/ESCAPESUITE/commit/99beeafe741f2b912cd28288057403b6f10bddc5))

## [1.3.0](https://github.com/bonham-technologies/ESCAPESUITE/compare/v1.2.0...v1.3.0) (2026-01-03)

### Features

- add toolbar, keyboard shortcuts, markers, and preview manipulation improvements ([7ce49cf](https://github.com/bonham-technologies/ESCAPESUITE/commit/7ce49cfc2cc9267fb0b5af90984ca2fdb5ba61ee))
- improve track UI with vertical volume slider and editable names ([c2b3e6a](https://github.com/bonham-technologies/ESCAPESUITE/commit/c2b3e6a24f0518c718cf56e08aea5ddff15642bc))
- improve track UI with vertical volume slider and editable names ([81ff143](https://github.com/bonham-technologies/ESCAPESUITE/commit/81ff143e41833e7bad685e39f7fe6770f4d94c0e))
- UX improvements - toolbar, keyboard shortcuts, markers, and preview manipulation ([d942f83](https://github.com/bonham-technologies/ESCAPESUITE/commit/d942f83e6cc68b4356ffc52ad3508caf88ea708a))

### Bug Fixes

- auto-create start keyframe for proper animation interpolation ([0c53561](https://github.com/bonham-technologies/ESCAPESUITE/commit/0c535611815918700f5bd0b521757b7ac9fb21c0))
- blur overlays now respect z-order and only affect lower layers ([52250e7](https://github.com/bonham-technologies/ESCAPESUITE/commit/52250e73e40d81241f44012736e2b70524a4c583))
- resolve nested button accessibility error in CollapsibleSection ([8ae87c6](https://github.com/bonham-technologies/ESCAPESUITE/commit/8ae87c63134201d87e67993c5832110db7e3e01f))

### Performance Improvements

- add advanced performance optimizations with full test coverage ([24f7438](https://github.com/bonham-technologies/ESCAPESUITE/commit/24f74382c0525727566ecbd011f44793938cfc4d))
- implement performance quick wins ([9a5415c](https://github.com/bonham-technologies/ESCAPESUITE/commit/9a5415cabaad5c654f38b386937f4e4ac2152cac))

## [1.2.0](https://github.com/bonham-technologies/ESCAPESUITE/compare/v1.1.0...v1.2.0) (2026-01-02)

### Features

- add Adobe Premiere-style keyframe editor ([a99b8de](https://github.com/bonham-technologies/ESCAPESUITE/commit/a99b8de14d989018c652f12308aa63ccb664fb53))
- add collapsible media library sidebar ([81e8bfb](https://github.com/bonham-technologies/ESCAPESUITE/commit/81e8bfbdfb99ce8484d6eec5fd0b36f05f710ac8))
- add collapsible media library sidebar ([a5d72cd](https://github.com/bonham-technologies/ESCAPESUITE/commit/a5d72cd8017c605be7494639e89020a27da11213))
- add interactive overlay transform controls on preview ([28fcd0b](https://github.com/bonham-technologies/ESCAPESUITE/commit/28fcd0bb5b477a1363259587d92a89a1b0fb52f6))
- add interactive overlay transform controls on preview ([e4bb211](https://github.com/bonham-technologies/ESCAPESUITE/commit/e4bb21179b437d77ea0771786e0ee1ef30ad8222))
- add keyframe preview manipulation with composite frame rendering ([5a3143b](https://github.com/bonham-technologies/ESCAPESUITE/commit/5a3143b18bd23df229144fb7c157893e4d0387a6))
- Adobe Premiere-style keyframe editor ([389f0ac](https://github.com/bonham-technologies/ESCAPESUITE/commit/389f0acfc14106cddfa6592d4c6b04ac9831c3d8))
- keyframe preview manipulation ([583cd43](https://github.com/bonham-technologies/ESCAPESUITE/commit/583cd4372342f6231ca78b88f98d8bfc5eb415ec))
- reuse empty tracks and UI improvements ([f23b9b6](https://github.com/bonham-technologies/ESCAPESUITE/commit/f23b9b6dc60829ea4f7eca5fc96a5bbfeb6be2b8))
- reuse empty tracks and UI improvements ([03fda3e](https://github.com/bonham-technologies/ESCAPESUITE/commit/03fda3e7024c4c9c6fad6bae60caad6e98699c71))

### Bug Fixes

- add rotation support to preview playback and export ([fa037e8](https://github.com/bonham-technologies/ESCAPESUITE/commit/fa037e80b130c6752e48ab0f33a3e029a8467c20))
- correct keyframe positioning and enable value dragging ([cba2711](https://github.com/bonham-technologies/ESCAPESUITE/commit/cba2711c1e874b6b652a181445ee8c12d42108bb))
- correct SVG coordinate calculation for preserveAspectRatio ([6c1e291](https://github.com/bonham-technologies/ESCAPESUITE/commit/6c1e291e716e022efbe0c7e6675d1a3e0469eecf))
- improve graph keyframe dragging and add delete functionality ([f3f71a0](https://github.com/bonham-technologies/ESCAPESUITE/commit/f3f71a076c1a880f91721d1042863f2f3c5fce33))
- improve keyframe editor UX with better drag handling and sizing ([4ed0452](https://github.com/bonham-technologies/ESCAPESUITE/commit/4ed04522ad51d316fce5b0b246f7a7222407bd35))
- selection handles follow animated keyframe values ([cd2fd37](https://github.com/bonham-technologies/ESCAPESUITE/commit/cd2fd37db51cf6d451f4b01bb00c8ce78a780148))
- wait for video seeks before drawing in keyframe preview ([b49b04a](https://github.com/bonham-technologies/ESCAPESUITE/commit/b49b04a6b083d59c35dba9d4ef289c896389fa39))

## [1.1.0](https://github.com/bonham-technologies/ESCAPESUITE/compare/v1.0.0...v1.1.0) (2026-01-01)

### Features

- add track audio control, auto-track creation, no-fill option, and blur overlay ([295e85a](https://github.com/bonham-technologies/ESCAPESUITE/commit/295e85a2c31c5df21fb400dea3e2cd0532c88c5c))

### Bug Fixes

- audio mixing and blur overlay behavior ([50cbe59](https://github.com/bonham-technologies/ESCAPESUITE/commit/50cbe593928e19a2825e0a991c4b587585ff201a))
- blur rotation no longer rotates underlying content ([dc28675](https://github.com/bonham-technologies/ESCAPESUITE/commit/dc286752b8af9a0dbf975423be245d5c6ef374c2))

## 1.0.0 (2026-01-01)

### Features

- add README badges, LICENSE, release-please, and CodeQL ([1635a48](https://github.com/bonham-technologies/ESCAPESUITE/commit/1635a48abb3141dc3a13eb0bd9f66ccdbac5b71f))
- add README badges, LICENSE, release-please, and CodeQL ([0e4d3f4](https://github.com/bonham-technologies/ESCAPESUITE/commit/0e4d3f4d5e888b47754b27acba2d86a1c5857ede))

### Bug Fixes

- replace CodeQL with npm audit for security scanning ([8222f1d](https://github.com/bonham-technologies/ESCAPESUITE/commit/8222f1d54f1ecf4f8630ce5ab80ba6ac247fc795))
- replace CodeQL with npm audit for security scanning ([c551f60](https://github.com/bonham-technologies/ESCAPESUITE/commit/c551f60be023853619b13fac7d5f8423e0829746))

---

## Pre-Monorepo History

The following versions were released before ESCAPEARTIST joined the ESCAPESUITE monorepo.

## [0.4.2] - 2024-12-11

### Added

- **Animation Section in Clip Inspector**
  - Animate In/Out dropdown selectors
  - Duration and easing controls per animation
  - Active animation badge indicator

### Changed

- Removed trim section from clip inspector (trimming done directly on timeline clips)

### Fixed

- Undo causing black preview window
- Stable dependency tracking for media URL changes

---

## [0.4.1] - 2024-12-10

### Added

- **Shape Overlay Blur Tool**

  - Region blur effect for shapes (rectangle, ellipse)
  - Blur amount slider (0-50px)
  - Useful for privacy blur and focus effects

- **Track Management**
  - Delete tracks with confirmation
  - Reorder tracks via drag handles
  - Clips automatically move to remaining track when track deleted

### Changed

- Improved transform controls with aspect ratio lock toggle
- Better reset transform behavior for overlays

### Fixed

- Export resolution matching preview resolution
- Track syncing issues during multi-track editing
- Transition rendering at clip boundaries

---

## [0.4.0] - 2024-12-09

### Added

- **Multi-Track Timeline**

  - Unlimited video/audio tracks
  - Per-track visibility, lock, and mute controls
  - Track height adjustment
  - Automatic clip compositing by track order

- **Blend Modes**

  - 8 blend modes: Normal, Multiply, Screen, Overlay, Darken, Lighten, Difference, Add
  - Per-clip blend mode selection

- **Transitions**

  - 11 transition types between clips
  - Fade, Dissolve, Wipe (4 directions), Slide (4 directions)
  - Configurable duration per transition

- **Transform Controls**

  - Position (X, Y) as percentage of canvas
  - Scale (X, Y) with lock toggle
  - Opacity control
  - Reset to defaults button

- **Effects**
  - Blur effect (0-50px range)
  - Applied during preview and export

### Changed

- Unified clip system (media and overlays as same entity)
- Improved timeline rendering performance

---

## [0.3.0] - 2024-12-08

### Added

- **MP4 Export**

  - H.264 video encoding via WebCodecs
  - AAC audio encoding
  - Full audio mixing from all tracks

- **Text Overlays**

  - Custom text with font selection
  - Font size, weight, style controls
  - Text color and background color
  - Text alignment (left, center, right)
  - Position anywhere on canvas

- **Shape Overlays**
  - Rectangle, Ellipse, Line, Arrow shapes
  - Fill color with opacity
  - Stroke color and width
  - Rotation support

### Changed

- Overlay clips now integrated into track system
- Improved export progress reporting

---

## [0.2.0] - 2024-12-07

### Added

- **WebM Export**

  - VP9 video encoding
  - Opus audio encoding
  - Quality presets (Low, Medium, High)
  - Resolution presets (Original, 1080p, 720p, 480p)

- **Image Support**

  - Import PNG, JPG, GIF, WebP
  - Default 5-second duration
  - Thumbnail generation

- **Audio Support**
  - Import MP3, WAV, OGG
  - Waveform thumbnail visualization
  - Audio mixing in export

### Changed

- Improved video metadata extraction
- Better storage quota handling

---

## [0.1.0] - 2024-12-06

### Added

- **Core Video Editing**

  - Video import and storage in IndexedDB
  - Single-track timeline with clips
  - Clip trimming (start/end points)
  - Clip splitting at playhead
  - Drag-and-drop clip repositioning

- **Preview Player**

  - Real-time video preview
  - Play/pause controls
  - Timeline scrubbing
  - Frame-accurate seeking

- **Project Management**

  - Save projects with embedded media
  - Load projects from file
  - Auto-save session state
  - Session restore on reload

- **Undo/Redo System**

  - 50-level history
  - Works with all editing operations

- **Media Library**
  - Thumbnail previews
  - Drag to timeline
  - Delete unused media

### Technical

- React 19 with TypeScript
- Zustand state management
- Vite build system
- Single-file output build

---

## Version History Summary

| Version | Date   | Highlights                                                              |
| ------- | ------ | ----------------------------------------------------------------------- |
| 1.2.0   | Jan 16 | Resizable timeline, volume keyframes, standalone licensing, export perf |
| 1.1.1   | Jan 10 | Shared package extraction, code deduplication                           |
| 1.1.0   | Jan 8  | Changesets, dependency sync                                             |
| 1.0.0   | Jan 1  | First monorepo stable release                                           |
| 0.4.2   | Dec 11 | Animation UI, bug fixes (pre-monorepo)                                  |
| 0.4.1   | Dec 10 | Shape blur, track management                                            |
| 0.4.0   | Dec 9  | Multi-track, transitions, blend modes                                   |
| 0.3.0   | Dec 8  | MP4 export, overlays                                                    |
| 0.2.0   | Dec 7  | WebM export, image/audio support                                        |
| 0.1.0   | Dec 6  | Initial release                                                         |

---

## Roadmap

### Planned Features

- [ ] Color correction and adjustment layers
- [ ] Audio waveform editor
- [ ] Advanced masking system
- [ ] Motion tracking
- [ ] Subtitle support (SRT/VTT)
- [ ] Template system
- [ ] Mobile/touch support
- [ ] WebGPU acceleration

### Under Consideration

- Collaborative editing
- Cloud storage integration
- Plugin architecture
- Advanced keyframe curves (bezier)
- Nested compositions
