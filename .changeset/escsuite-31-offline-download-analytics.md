---
'@escapesuite/plan': patch
---

The two "Download the offline build" links on the landing page now fire an
"Offline Build Downloaded" analytics event (hosted build only, same as every
other event) before the browser follows them to the GitHub release. Previously
the single most interesting conversion on the page — someone leaving for the
offline build — was invisible in the dashboard.
