# Reference image for the headless ARTIST render kit.
#
# The base image already carries the exact Chromium build Playwright 1.62.1 expects, plus the
# OS libraries and the fonts text overlays render with — so nothing is downloaded at build or
# render time. The kit assembler fails the build if this tag ever drifts from the pinned
# Playwright version.
#
# `dist/` must exist before you build: it is git-ignored, so in a repo checkout assemble it
# first. From an unpacked kit tarball there is nothing to assemble — `dist/` is already there
# and the build context is the kit directory itself.
#
#   # from a repo checkout:
#   pnpm --filter @escapesuite/headless-artist run build
#   docker build -t headless-artist services/headless-artist
#
#   # from an unpacked kit:
#   docker build -t headless-artist .
#
#   docker run --rm -v "$PWD/in:/in:ro" -v "$PWD/out:/out" headless-artist --job /in/job.json
#
FROM mcr.microsoft.com/playwright:v1.62.1-noble

WORKDIR /app

# The image ships the browser already; npm must not fetch another copy.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# This resolves exactly one runtime dependency: playwright — pinned to an exact version in
# package.json, so what npm installs here always matches the browser this base image carries.
# Drop `--omit=optional` to pull in @aws-sdk/client-s3 as well, which the s3 sink needs.
COPY package.json ./
RUN npm install --omit=dev --omit=optional --ignore-scripts && npm cache clean --force

COPY dist/ ./dist/

# Where the CLI finds the render bundle it drives.
ENV HEADLESS_BUNDLE_PATH=/app/dist/headless.html

# Running as a non-root user keeps Chromium's own sandbox usable, so HEADLESS_NO_SANDBOX
# stays off. If you override this with USER root, set HEADLESS_NO_SANDBOX=true as well.
USER pwuser

ENTRYPOINT ["node", "dist/cli.js", "render"]
CMD ["-"]
