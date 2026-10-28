<!-- Vendored from bonham-ops, policy v2. Edit there and re-run bin/vendor-claude-setup. -->
# Autopilot: the Confluence record (steward and scout)

Part of the autopilot policy. `.claude/rules/autopilot.md` and
`.claude/rules/autopilot.local.md` load in every session and apply here too.

### Record in Confluence

The OPS space is the durable record; Jira carries the work. Local sessions write it
through hooks, and scheduled runs have no hooks, so the steward writes its own entry.

**Before posting the digest,** find the project's Session Log page:
`searchConfluenceUsingCql` with
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
  trim them. The one exception is **Rotate before you append**, below, which moves the
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
- Use `getConfluencePage` for the current body and version, then
  **Rotate before you append** if the page needs it, then `updateConfluencePage`. Read the title back from the response; if it differs, stop
  writing to Confluence and report it in the run summary. On a version conflict, fetch
  again and retry once.
- **Once per day and role:** if the body already has a heading for today ending in
  this role (`· autopilot steward` or `· autopilot scout`), this run's entry is
  there: an earlier run, or a retry whose response was lost. Don't add another. Check
  again before the retry.

### Rotate before you append

The connector replaces a page's whole body, so a live Session Log has to stay small
enough to fetch and rewrite in one call. Local sessions follow this too, through
`hooks/session-log-flush.md`.

After `getConfluencePage` and before inserting the new entry, measure the body as
markdown. If it is over **40,000 characters** or holds more than **12 entries**, rotate
first:

1. Take entries from the bottom, oldest first, until what stays is under 20,000
   characters, keeping at least the newest 3 entries.
2. Create a child page of the Session Log titled
   `ESCAPESUITE — Session Log archive <oldest date> to <newest date>`, using the dates
   of the entries it holds. Its body is the line "Archived from ESCAPESUITE — Session
   Log on <YYYY-MM-DD>. Entries are unchanged, newest at the top." and then the moved
   entries exactly as fetched. Keep each archive under about 40,000 characters; make
   more than one if needed.
3. Fetch each archive back and check that every moved entry's heading is there, in
   order. If any is missing, stop: leave the live page untouched, write nothing more to
   Confluence this run, and report it.
4. Only then rewrite the live page: the intro paragraph; then the paragraph "Older
   entries are on the archive pages under this one:" with a link to each archive, newest
   first (create it, or add the new links at its front); then the entries that stay.
   Insert the new entry in the same update.

Never edit an archive page after creating it. Rotation moves entries: it never deletes,
reorders or reformats one. Use `contentFormat: "markdown"` for the fetch and every write
here: these pages hold only headings, lists, bold, code and links, which round-trip, and
markdown is about a third the size of ADF.

**Never** add or edit a `## Memory` section on any page: those sync into local memory and
belong to local sessions. Never rewrite the human-written pages, such as Architecture,
Charter & Scope and their children. If one looks stale against what merged, file a P3
`ap-auto` ticket "Refresh <page title> for <changes>" that names each stale statement
and what replaced it, after searching Jira for an open one.
