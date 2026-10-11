---
'@escapesuite/artist': patch
---

A departed tab's saved session is claimed by the first new tab it is offered to, so two tabs opened together after a crash no longer both adopt it; the decode worker's engine notes record why WebKit stays on the in-page decoder.

When ESCAPEARTIST is opened in a new tab, it offers to resume work from a tab that closed or crashed. Before this change, two new tabs opened at the same moment were both offered the same session, and restoring it in both left two copies. Now the first tab it is offered to holds on to that offer until you answer, and the other tab is offered the next saved session or nothing. If the tab that saved the session comes back while another tab is offering it — a reload after the tab crashed, or the browser reopening it — it is still offered its own work, and while it stays open the other tab's prompt leaves that work alone whichever button you press — in the rare moment where both act at once, you end up with two copies of the work, never none. The notes on the background-tab export decoder now also record why Safari's engine keeps decoding in the page: its decoder gets colours slightly wrong, and correcting that would cost an extra copy of every frame.
