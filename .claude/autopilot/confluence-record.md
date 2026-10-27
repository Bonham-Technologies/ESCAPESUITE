<!-- Vendored from bonham-ops (8b8c74c). Edit there and re-run bin/vendor-claude-setup. -->
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
  trim them.
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
  `updateConfluencePage`. Read the title back from the response; if it differs, stop
  writing to Confluence and report it in the run summary. On a version conflict, fetch
  again and retry once.
- **Once per day and role:** if the body already has a heading for today ending in
  this role (`· autopilot steward` or `· autopilot scout`), this run's entry is
  there: an earlier run, or a retry whose response was lost. Don't add another. Check
  again before the retry.

**Never** add or edit a `## Memory` section on any page: those sync into local memory and
belong to local sessions. Never rewrite the human-written pages, such as Architecture,
Charter & Scope and their children. If one looks stale against what merged, file a P3
`ap-auto` ticket "Refresh <page title> for <changes>" that names each stale statement
and what replaced it, after searching Jira for an open one.
