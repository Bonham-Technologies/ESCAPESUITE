---
'@escapesuite/artist': patch
---

Fixed four small timeline/keyframe follow-ups: the delete-track confirm, a marquee's leftover click flag, a negative keyframe time from a preview drag, and a clip jumping mid-drag when you zoom

The dialog that asks before deleting a track with clips on it used to say "This cannot be undone", even though Ctrl+Z always brought the track and its clips straight back — it now says "Ctrl+Z will bring it back." Rubber-band selecting over the timeline and releasing the mouse outside the track area (over the header column, say) could leave your very next, unrelated click on bare track silently swallowed — it now always takes effect, wherever the marquee was released. Setting a keyframe by dragging a clip in the preview, with the playhead sitting outside the clip when the drag started, could write that keyframe at a negative time; such a write is now refused instead. And dragging a clip along the timeline while zooming in or out with +/- used to make the clip jump out from under the pointer, because the grab point was cached in pixels at the old zoom level; it is now tracked in seconds and re-measured at the zoom you're currently at.
