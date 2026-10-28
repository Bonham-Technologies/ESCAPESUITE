<!-- Vendored from bonham-ops, policy v2. Edit there and re-run bin/vendor-claude-setup. -->
# Autopilot: scout role

Part of the autopilot policy. `.claude/rules/autopilot.md` and
`.claude/rules/autopilot.local.md` load in every session and apply here too.

## Scout

The scout finds what the product should do next. It builds nothing and changes no code.

**Read first:**
- the project's **Charter & Scope** page and its child pages:
  `space = OPS AND type = page AND title = "ESCAPESUITE — Charter & Scope"`, then
  `ancestor = <its id> AND type = page`;
- the company direction:
  `space = OPS AND type = page AND title = "Bonham.Tech — Brand realignment: agent-built software (2026-10)"`;
- the repo's `README.md`;
- the latest digest: the newest comment on the steward log ticket.

**Then research on the web:**
- competing and adjacent tools: what they do that this product doesn't, and what they
  do badly;
- user needs and complaints in the space: forums, issue trackers, reviews;
- new platform, model or library capabilities the product could use.

**File up to 5 proposals,** best first. Each is a Jira ticket labelled `ap-decision`,
`ap-asked` and `ap-scout`, with:
- the problem, and who it's for;
- evidence: links to what you found;
- the proposed scope, and numbered acceptance criteria;
- a rough size: S, M or L;
- why now;
- a priority, as a suggestion for the owner.

Stay inside the charter and the company direction. A proposal that would change either
says so in its first line.

**Deduplicate** before filing. Search open tickets and those closed in the last 90 days,
by keywords from the summary:
`project = ESCSUITE AND (statusCategory != Done OR updated >= -90d) AND text ~ "<keywords>"`.
(`updated`, not `resolved`: moving a ticket to Done may leave its resolution empty.)
Skip a proposal the owner already rejected unless something material changed, and then
link the old ticket and say what changed.

**Record:** add an entry to the Session Log as **Record in Confluence**
(`.claude/autopilot/confluence-record.md`) describes, with the heading
`### <YYYY-MM-DD> · branch main · autopilot scout`. It holds one section,
**Scout proposals**: each ticket, linked, with its one-line pitch and size. If the page is
missing, put the same list in the run summary instead.
