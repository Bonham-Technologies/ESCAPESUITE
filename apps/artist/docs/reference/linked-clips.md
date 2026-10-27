# Linked clips (`src/store/linkedClips.ts`)

A take recorded with ESCAPECRAFT's **separate tracks** option lands as one clip
per part (screen, webcam, microphone, system audio), each on its own row.
Until ESCSUITE-355 nothing tied them together. A user who split the picture,
deleted a segment and closed the gap got a microphone clip that was never cut,
so the deleted speech played under the wrong frames.

**The link.** `Clip.linkGroupId`: every clip carrying the same id is edited as
one. `placeTakeOnTimeline` gives all the parts of a take of more than one part
one fresh id. Every other clip has none, and so does every clip of a project
written before links existed. `parseProject` refuses a `linkGroupId` that is
present but not a non-empty string.

**A group is a segment, not a take.** `splitClip` cuts every linked clip the cut
crosses at the same *timeline* time, each at its own offset (a microphone
captured half a second late is cut half a second earlier into itself). The left
halves keep the group they had; the right halves, and any linked clip lying
wholly after the cut, join a new one. So dragging one piece of a cut take moves
its partners, not every piece of the take. A cut within 1 ms
(`LINK_EDGE_EPSILON`) of a partner's edge leaves that partner whole rather than
cutting a sliver off it, and a partner starting at the cut goes to the right.

**What acts on the group.** Unless the user holds **Alt** (`alone`):

| Action | Linked behaviour |
|---|---|
| Split (`Ctrl+B`, the razor, the inspector's Split) | Cuts every linked clip at the same time, one undo step |
| Delete (`Delete`/`Backspace`, the toolbar, the inspector) | Removes the linked clips too, one undo step |
| Ripple delete (ripple tool + `Delete`) | Removes them and closes the gap on each one's own row |
| Ripple trim (ripple tool + an edge drag) | Moves the same edge of every linked clip by the same amount, the least any of them can follow, and closes the gap on each one's own row, one undo step (`useTrimDrag`, ESCSUITE-360) |
| Drag | Moves the linked clips by the same time and rows, through `moveClips`; refused whole when any of them cannot land (`canMoveSelectedClips`), and their boxes follow the ghost (`DragState.companions`) |

`Ctrl+Alt+B` is matched on `e.code === 'KeyB'` because macOS reports Option+B
as `∫`. Alt during a drag is read at the mousedown and on every move. Some Linux
window managers take Alt+drag for moving windows; there, press Alt after the drag
has started, or use **Unlink**.

A linked drag stops where its earliest clip reaches 0, so the partners never
fall out of step against the left edge. A drag to another row moves every
linked clip by the same number of rows.

**What Alt leaves behind.** An Alt-split cuts one clip and keeps both halves in
the group, so a later linked drag moves both halves with the partners. An
Alt-drag keeps the link but leaves the clips out of step; Unlink them if that is
meant to last.

**Locks.** A linked clip on a locked track is left alone by a split or a delete:
the lock means "do not touch this row". A ripple delete, a ripple trim and a
drag refuse whole instead: closing the gap on some rows only would put the later pieces out of
step. Unlink leaves a last partner on a locked track linked.

**Unlinking.** The inspector's Actions section shows **Unlink** for a clip linked
to at least one other (`unlinkClip`). The last clip left in a group is unlinked
too, since a group of one links nothing.

**Copies.** `duplicateClip` drops the link. `pasteClips` relinks copies to each
other with fresh ids (`relinkCopies`), so a pasted take stays a take but is not
tied to the one it came from; a copy with no partner in the paste is unlinked.

**Not linked.** A plain (non-ripple) trim, a move to another row from the
inspector, mute and the inspector's per-clip settings all stay per clip.

Tests: `src/store/linkedClips.test.ts`, the Alt cases in
`useAppKeyboardShortcuts.test.ts` and `useClipDrag.test.ts`,
`useTrimDrag.linked.test.ts`, `ClipEditor.unlink.test.tsx`, and the browser
journeys `apps/e2e/tests/regressions/ESCSUITE-355.spec.ts` and
`ESCSUITE-360.spec.ts`.
