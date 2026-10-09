---
'@escapesuite/craft': patch
'@escapesuite/shared': patch
---

The offline recorder no longer offers editor buttons that open an error page

If you ran the downloaded ESCAPECRAFT file by double-clicking it, "Open Editor" and each recording's "Open in Editor" button opened a browser error page, because the editor they pointed at doesn't exist when a page is opened from disk. Now, opened that way, both buttons stay in place but are greyed out, with the reason beside them: "Open the offline ESCAPEARTIST file and import this recording's WebM." Your recordings are saved as before and Download WebM still works. Nothing changes on the website, or when the recorder is embedded in another page.
