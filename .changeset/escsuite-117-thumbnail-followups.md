---
"@escapesuite/artist": patch
---

A source restored by undo gets its thumbnail back, and the handoff's tiles no longer go blank in development builds.

Freeing a source's thumbnail when it leaves the media library left two loose ends. A source that came *back* — undo across the reset a project load does, or a restore that found nothing stored — showed an empty tile until it was next genuinely reloaded, even though its picture was still in storage all along: the library now reads it again and puts it back, without adding anything to undo. And the ESCAPECRAFT handoff kept its own list of the thumbnails it had made and freed them when the editor's startup work finished, which in a development build — where React deliberately mounts everything twice — freed the very handles the second pass was relying on, so every tile of a handed-over take went blank. The media library owns those pictures now, from the moment the take arrives in it, and nothing else frees them behind its back.
