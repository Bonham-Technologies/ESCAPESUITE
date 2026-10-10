---
'@escapesuite/artist': patch
---

Saving a project whose sources are too big for the .veditor format is refused with the size and the limit, instead of writing a file with no video in it.

A project whose videos add up to more than the .veditor format can hold used to say "Project saved successfully" and download a tiny file with no video in it, which then failed to open. Now the save is refused up front with a message giving the project's size, the format's limit and the largest source, nothing is downloaded, and "save and load" stays on the dialog instead of loading over the work you chose to save.
