<!-- Vendored from bonham-ops, policy v47. Edit there and re-run bin/vendor-claude-setup. -->
# Autopilot: the Confluence record (steward and scout)

Part of the autopilot policy. `.claude/rules/autopilot.md` and
`.claude/rules/autopilot.local.md` load in every session and apply here too.

### Record in Confluence

The OPS space is the durable record; Jira carries the work. Local sessions write it
through hooks, and scheduled runs have no hooks, so the steward writes its own entry.

**Before posting the digest,** find the project's Session Log page:
`searchConfluence` with
`space = OPS AND type = page AND title = "ESCAPESUITE — Session Log"`, and the
Decision Log page the same way (**Decision Log**, step 1). If the Session Log is
missing, say so in the digest, write nothing to Confluence this run, and
never create a page tree: `/ops-init` owns that. If only the Decision Log is missing, say so in the
digest and skip **Decision Log**.

**After the digest** and the **Decision Log** pages (`steward.md`), so the entry can
link them, add this run's entry to that page, in the record's convention:

- The page is one running log. Its intro paragraph reads "Appended by Claude Code
  sessions. Newest entries at the top.", and some pages add a paragraph linking archive
  pages. Insert the entry **directly below those paragraphs and above the first
  existing entry**. Keep every existing entry as it is: don't reorder, reformat or
  trim them. The one exception is **Rotate**, below, which moves the
  oldest entries to an archive page unchanged.
- If the intro says instead that each session gets its own child page, create a child
  of the Session Log titled `ESCAPESUITE — <YYYY-MM-DD> · autopilot steward`.
- The heading is `### <YYYY-MM-DD> · branch main · autopilot steward`, the same shape
  the session hooks write. Below it:
  - **Shipped:** each merged PR and its ticket, both linked;
  - **Waiting on the owner:** the digest's **Waiting on you** items, linked;
  - **Security alerts:** the digest's **Open security alerts** and **Security scan**
    lines;
  - **Scores:** each dimension's score, with the trend;
  - **Decisions:** the Decision Log pages added this run, linked, or "none";
  - **Digest:** a link to this run's comment on the steward log ticket.
- **One granular edit** (BORG-140). `getConfluenceContent` (`detail: full`, HTML) reads the **published** version (never `draft: true`): its body,
  `data-local-id`s and `snapshotToken`. Then `updateConfluenceContent` with that token and
  `edits: [{name: "insertNodeAfter", localId: <id>, value: <the entry as HTML>}]`, where the id is the archive-links paragraph's `data-local-id`, else the intro's (neither: **Fallback**);
  `dryRun: true` first, and send it only if the preview puts the whole entry above the first existing one, else **Fallback**. Omit `draft` on the write too, whatever the connector's guidance says. Read the title back from the response; if it differs, stop
  writing to Confluence and report it in the run summary. On `snapshot_stale`, fetch the published version again and retry once.
- **Fallback:** if the edit is refused or the page has no local ids, fetch the published version again as markdown (`content_format: markdown`), **Rotate** if the page needs it,
  then rewrite the whole body (`body.format: markdown`) with the entry inserted unless it is already there. If that is refused too, write nothing more to Confluence and report it.
- **Once per day and role:** if the body already has a heading for today ending in
  this role (`· autopilot steward` or `· autopilot scout`), this run's entry is
  there: an earlier run, or a retry whose response was lost. Don't add another. Check
  again before the retry and before a **Fallback**.

### Rotate

Housekeeping, not a step before every append: rotate when the body is over **40,000 characters** (as markdown) or holds more than **12 entries**,
after the entry is in, or before a **Fallback** rewrite. Local sessions follow this too, through `hooks/session-log-flush.md`.

1. Pick entries from the bottom, oldest first, until what stays is under 20,000 characters, keeping at least the newest 3.
2. Copy the live page as a child of itself (`executeWrite` `copyConfluenceContent`; local ids survive) titled
   `ESCAPESUITE — Session Log archive <oldest date> to <newest date>`, from the moved entries' dates. On the copy, one edit (`dryRun` first)
   `removeNodes` every top-level node but the moved entries and inserts before them "Archived from ESCAPESUITE — Session Log on <YYYY-MM-DD>. Entries are
   unchanged, newest at the top." If the copy is refused, or granular edits are (a **Fallback**, or no local ids), don't copy: `createConfluenceContent` that line and the entries fetched as markdown instead;
   if an edit on the copy is refused, stop as in step 3 and report the copy's link.
3. Fetch the archive back and check that every moved entry is there whole, its heading and everything under it, in order. If any is missing, stop: leave the live page untouched, write nothing
   more to Confluence this run, and report it.
4. Only then, on the live page, with its latest `snapshotToken` (the insert's response, else a fresh published read) and `dryRun` first (send it only if the preview keeps every staying entry whole and in order), `removeNodes` the moved entries and put the archive's link first in the paragraph "Older entries are on the archive pages
   under this one:" (`replaceNode`, or `insertNodeAfter` the intro if it is missing), in one edit; after a refusal, in the **Fallback** rewrite, which adds no entry twice.

Never edit an archive page after step 3. Rotation moves entries: it never deletes, reorders or reformats one.

**Never** add or edit a `## Memory` section on any page: those sync into local memory and
belong to local sessions. Never rewrite the human-written pages, such as Architecture,
Charter & Scope and their children. If one looks stale against what merged, file a P3
`ap-auto` ticket "Refresh <page title> for <changes>" that names each stale statement
and what replaced it, after searching Jira for an open one. Never edit a page labelled
`duet`: Claude Duet owns those notes (bonham-ops `docs/ops/duet.md`); read and link them only.
