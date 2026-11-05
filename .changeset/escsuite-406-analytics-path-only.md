---
'@escapesuite/plan': patch
'@escapesuite/craft': patch
'@escapesuite/artist': patch
'@escapesuite/shared': patch
---

The hosted site's analytics no longer send the page's query string. When a website embedded ESCAPECRAFT or ESCAPEARTIST, anything it put in the app's address (a video's address, a project title, a whole project, its own address or a window name) used to be sent to Vercel Web Analytics with every page view and event. Each record now carries only the page's path, such as `/artist/`. The offline build is unchanged: it sends nothing at all.
