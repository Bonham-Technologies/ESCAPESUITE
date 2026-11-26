# Product Hunt launch kit: ESCAPE Suite

Everything needed to submit ESCAPE Suite to Product Hunt, ready to paste into the launch
form. Submitting, scheduling and launch day are done by hand from the maker's personal
account; no tool or script touches Product Hunt.

Ticket: ESCSUITE-527.

## The launch link

**Launch link:** `https://escapesuite.tech`

This is the only place the link is written; everything below says "the launch link".
When you paste a draft, put the link itself where it says "the launch link".
escapesuite.tech already serves the apps, escapesuite.io forwards to it, and the hub's
canonical tags name it; the last references to the old host are tracked as Ticket:
ESCSUITE-506. Check that it is finished before scheduling, so the link never changes after
launch.
If the launch host changes, edit the line above and nothing else.

The no-signup "try it" paths, all under the launch link:

| What | Path |
|---|---|
| The hub | `/` |
| Record (ESCAPECRAFT) | `/craft/` |
| Edit (ESCAPEARTIST) | `/artist/` |

The offline builds (one self-contained HTML file each for ESCAPECRAFT and ESCAPEARTIST)
are on the GitHub releases page; the hub's "All downloads" link goes there.

## Form limits, as checked on 2026-11-26

From Product Hunt's launch guide, "Build your product page"
(https://help.producthunt.com/en/articles/17834537-4-build-your-product-page). Check
again on the day you fill in the form.

| Field | Limit |
|---|---|
| Name | up to 40 characters |
| Tagline | up to 60 characters |
| Description | up to 500 characters |
| Logo (thumbnail) | 240×240 px recommended; JPG, PNG or GIF, up to 2 MB (an animated GIF plays only on hover) |
| Gallery | at least 1 image, 1270×760 px recommended |
| Launch tags | required, up to 3 |
| First comment | up to 5,000 characters; pinned at the top when the launch goes live |
| Launch date | from tomorrow up to 30 days ahead; goes live at 12:01 AM Pacific and runs that whole day |

Required before a launch can be scheduled: name, tagline, description, logo, at least one
gallery image, launch tags, and your role (maker).

## Name

ESCAPE Suite

## Tagline

Pick one (character counts in brackets):

1. **Record and edit how-to videos without uploading a byte** (54), recommended
2. Screen recorder and video editor that stay in your browser (58)
3. How-to videos for networks the cloud can't reach (48)

## Description

> ESCAPE Suite is a free, open-source screen recorder and video editor that runs entirely
> in your browser. Record your screen, webcam and microphone, trim the mistakes, blur
> anything sensitive, add captions and text, and export WebM, MP4 or GIF. Your footage
> is never uploaded: no account, no sign-up, no server doing the work. The recorder and
> editor also come as single HTML files you can copy onto an air-gapped network and open
> with no internet at all. Apache-2.0.

(466 characters.)

## Launch tags

Up to three; pick the closest names the form offers:

1. Open Source
2. Video
3. Privacy

## Links

- Website: the launch link.
- GitHub: https://github.com/Bonham-Technologies/ESCAPESUITE

## Gallery

At 1270×760, in this order. All are shots of the live app with synthetic test media (a
moving gradient and a tone), so none holds personal data.

| # | File | What it shows |
|---|---|---|
| 1 | [`1-hub.png`](product-hunt/1-hub.png) | The hub: "How-to videos for networks the cloud can't reach", with Start recording and Open the editor |
| 2 | [`2-craft-recording.png`](product-hunt/2-craft-recording.png) | ESCAPECRAFT mid-recording: live preview, timer and microphone meter |
| 3 | [`3-artist-editing.png`](product-hunt/3-artist-editing.png) | ESCAPEARTIST with the recording on the timeline and a "100% local. No uploads." text overlay |
| 4 | [`4-why-offline.png`](product-hunt/4-why-offline.png) | Why teams behind a firewall use it: runs air-gapped, one copy for a whole organisation, nothing leaves the building, no installers |

Optional fifth item: the README's demo GIF (`docs/media/demo.gif`), or a short clip from
the latest walkthrough video, added as the launch's video link.

**Logo:** [`thumbnail.png`](product-hunt/thumbnail.png), 240×240, the suite's mark as it
appears in the hub's tab icon. The suite has no separate published product identity yet;
if one is published before launch, use its 240×240 mark instead.

**Re-take the shots** in launch week, so they match the live app:

```bash
pnpm install
pnpm --filter @escapesuite/e2e exec playwright install chromium
node docs/launch/product-hunt/capture.mjs   # BASE_URL=... to shoot another host
```

## First comment (maker)

A draft in the maker's own voice. Edit it until it sounds like you; keep it about this
length.

> Hi Product Hunt! I'm Matty, and I made ESCAPE Suite.
>
> Many online screen recorders upload your footage to their own servers before you can
> trim it or share it. That's a non-starter when the thing on your screen is an internal
> system, a customer's data, or a network that isn't connected to the internet in the
> first place.
>
> So ESCAPE Suite does all of it in the browser. ESCAPECRAFT records your screen, webcam
> and microphone; ESCAPEARTIST trims, blurs, captions and exports to WebM, MP4 or GIF.
> Every frame is processed on your own machine. There's no account and nothing to
> install, and if you need it on an air-gapped network, the recorder and the editor are
> each one HTML file you can copy across and open offline.
>
> To be straight about what does touch a network: the hosted site counts page views and a
> few events (like "Export Completed") with Vercel Web Analytics. Nothing you record, type
> or export is ever sent, and the offline files send nothing at all. The Known limitations
> page lists exactly what goes out.
>
> How it's built: I work with AI coding agents. They write most of the code and the
> tests; I set the direction and the rules for what ships, and every change has
> to pass the full test suite in CI before it merges. Everything is in the open on
> GitHub under Apache-2.0, including the tests and the changelog.
>
> What I'd love feedback on:
> - Where does recording or exporting fall over in your browser? (Firefox and Safari have
>   a few known gaps, listed on the Known limitations page.)
> - What would you need before you'd use this for training or how-to videos at work?
> - What's missing from the editor that you reach for every time?
>
> Try it at the launch link, no sign-up. I'll be here all day answering questions.

## Launch day

### Before the day

- [ ] The launch link is the canonical host (see "The launch link").
- [ ] Gallery re-taken with `capture.mjs` and checked by eye.
- [ ] The launch is created from the personal account, with every required field filled,
      scheduled for the chosen date (up to 30 days ahead), not left as a draft.
- [ ] The first comment is pasted into the form, so it is pinned when the launch goes live.

### On the day (from 12:01 AM Pacific)

- [ ] Check the launch is live and the first comment is pinned.
- [ ] Post the LinkedIn and X drafts below.
- [ ] Answer every comment that day.
- [ ] Never ask anyone for upvotes, in a post, a message or a group. Product Hunt's rules
      forbid it and it can get the launch removed. Ask people to try it and say what they
      think instead.

### The day after

- [ ] Note visits and GitHub stars from the launch (there are no sign-ups to count).

### LinkedIn post (personal profile, first person)

> I launched ESCAPE Suite on Product Hunt today.
>
> It's a screen recorder and video editor that runs entirely in your browser. You record,
> trim, blur and caption a how-to video, and your footage is never uploaded anywhere. There's
> no account, and there are single-file versions for networks with no internet at all.
>
> I built it for the people who make training and how-to videos inside organisations
> where "just upload it to our cloud" isn't an option.
>
> It's free and open source (Apache-2.0). I'd love to hear what breaks, what's missing,
> and what you'd need before using it at work. Questions in the comments, and I'm
> answering on Product Hunt all day.
>
> Try it: the launch link

### X post (company account)

Post without a link, then put the links in a reply.

> ESCAPE Suite is on Product Hunt today: a screen recorder and video editor that runs
> entirely in your browser. Record, trim, blur, caption and export without uploading a
> single frame. Free and open source.

Reply:

> Try it with no sign-up: the launch link
> Product Hunt: (the launch's Product Hunt page)

## Content rules this kit follows

- One link home: the launch link is the product's own site.
- The posts are about the product; nothing in them is about anything else.
- No request for upvotes anywhere.
