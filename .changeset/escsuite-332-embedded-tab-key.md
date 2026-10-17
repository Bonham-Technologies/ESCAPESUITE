---
'@escapesuite/artist': patch
---

Two ESCAPEARTIST editors framed in one host page keep a saved session each.

Every same-origin frame of a page shares the page's tab storage, so a second editor frame used to take over the first one's session id, and after the host page reloaded the two frames were offered each other's work. An embedded editor no longer keeps its id there. Every host that frames the editor — one frame or several — should name each frame with the new `?tabKey=<name>` URL parameter (trimmed, up to 120 characters, used only as part of a storage key): each named frame then keeps its own autosaved session across a host reload and is offered it back. Without a `tabKey`, an embedded editor's session id lasts for that page load, so nothing is overwritten or lost, but after a reload each frame's last session is offered like any closed tab's, to whichever frame asks first — a single framed editor included, which also means Start Fresh leaves that previous session in storage (another tab's, by the ESCSUITE-306 rule) rather than deleting it, until the 30-day prune. Giving two frames the same `tabKey` logs one console warning, and the second frame keeps its session for that page load only. An editor that is not framed is unchanged.
