# Contributing to ESCAPE Suite

Thanks for helping! ESCAPE Suite is a Turborepo monorepo (pnpm), licensed under the
[Apache License 2.0](LICENSE). By contributing you agree that your contribution is
licensed under the same terms.

## Setup

```bash
pnpm install
pnpm dev        # all apps: plan :5173, craft :5174, artist :5175
```

## Before you open a PR

```bash
pnpm lint && pnpm test && pnpm build
pnpm test:e2e   # Playwright (Chromium); needs `pnpm build` first
```

- Keep PRs focused; follow the existing code style (ESLint enforces most of it).
- Add or update tests for behavior changes.
- Conventional-commit style titles (`feat:`, `fix:`, `chore:`…) are appreciated.

## Developer Certificate of Origin

Every commit in a pull request from a fork must be signed off under the
[Developer Certificate of Origin 1.1](https://developercertificate.org/): a
`Signed-off-by:` trailer with your real name and the same email as the commit's
author. Git adds it for you with `-s`:

```bash
git commit -s -m "fix: describe the change"
```

To sign off commits you have already made on your branch, run
`git rebase --signoff origin/main` and force-push the branch. The **DCO** check on
each pull request from a fork lists any commit that is missing its sign-off.
Commits made by bots (Dependabot, the changesets release bot) are exempt, and so are
branches maintainers push to this repository itself.

By signing off you certify the DCO, which says, in short, that you wrote the
change or otherwise have the right to submit it under the project's licence.

## Notes

- Everything runs client-side — no backend, no accounts, no uploads.
- Video export uses WebCodecs (Chrome/Edge only); recording works in all
  modern browsers.
