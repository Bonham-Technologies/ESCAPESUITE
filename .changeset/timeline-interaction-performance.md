---
'@escapesuite/artist': patch
---

Editing the timeline does less work per pointer move: a clip drag spends about a fifth less JavaScript per pointer frame and a rubber-band selection about half, measured, because the track headers and the ruler no longer redraw on every frame of a gesture and a drag now measures the track area, binds its listeners and builds its snap points once when you press the mouse instead of on every move. The clip inspector and the toolbar no longer re-render on every playback tick, so playback leaves more of the main thread free — only the Split button now follows the playhead, and only when its enabled state actually changes.
