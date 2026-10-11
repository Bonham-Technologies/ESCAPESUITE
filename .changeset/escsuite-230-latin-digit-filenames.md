---
'@escapesuite/craft': patch
---

Downloads are named `recording_YYYY-MM-DD_HH-mm-ss` from the take's own timestamp, so they sort by time and keep their date in every language's digits.

In a browser whose language writes digits that are not 0-9 (Arabic, Persian, Hindi, Bengali and others), every WebM, MP4 and M4A download used to be called `recording_____…` and two takes could not sit in one folder. The filename now comes from when the take was recorded rather than from the name shown in the list, which still follows your language. A webcam or audio part of a separate-tracks take keeps its label on the end, for example `recording_2026-10-10_15-04-05_webcam.webm`.
