# Reference image for the headless ARTIST render kit.
#
# The base image already carries the exact Chromium build Playwright 1.63.0 expects, plus the
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
#   docker run --rm -v "$PWD/in:/in:ro" -v "$PWD/out:/out" headless-artist render --job /in/job.json
#   docker run --rm headless-artist --version
#
# `tini` is PID 1 (see ENTRYPOINT): under `serve`, every render leaves Chromium's own helper
# processes orphaned when the browser closes, and PID 1 must reap them or they pile up as
# zombies until the container's pid limit. Node does not reap strangers. `docker run --init`
# is therefore redundant here, but harmless.
#
# The container user is pwuser, uid/gid 1001 (in this base image uid 1000 is `ubuntu`).
# A mounted output directory must be writable by 1001; a volume job whose directory is not
# is refused before the browser starts (exit 2 / HTTP 400).
#
# The HTTP service mode is the same image with a different command. It has no authentication,
# so publish the port only on an interface you trust:
#
#   docker run --rm -p 127.0.0.1:8787:8787 -v "$PWD/out:/out" headless-artist serve --host 0.0.0.0
#
FROM mcr.microsoft.com/playwright:v1.63.0-noble

# The base image ships no init. Installed as root, before USER drops privileges.
RUN apt-get update \
    && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/*

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

# This image is built with --omit=optional (above), so it never has @aws-sdk/client-s3: an s3
# job would otherwise be advertised by `serve`'s /healthz and accepted by POST /render, then
# fail only once ensureSinkReady's probe runs. Narrowing the default here means `serve`
# refuses an s3 job with 403 instead. Drop `--omit=optional` above and widen this back to
# volume,webhook,s3 (cli.ts's own DEFAULT_SINKS) to use this image with the SDK installed.
ENV HEADLESS_SINKS=volume,webhook

# Running as a non-root user keeps Chromium's own sandbox usable, so HEADLESS_NO_SANDBOX
# stays off. If you override this with USER root, set HEADLESS_NO_SANDBOX=true as well.
# pwuser is uid 1001, gid 1001 in this base image -- every document that tells an operator
# which owner to give /out says 1001, so do not change the user without changing them.
USER pwuser

# ENTRYPOINT does not bake in the "render" command, so any CLI command works, not just
# rendering: `docker run … headless-artist --version`, `docker run … headless-artist render …`.
# CMD supplies the default when no arguments are given at all — read a job spec from stdin.
# tini is PID 1 so orphaned Chromium helpers are reaped (see the header).
ENTRYPOINT ["/usr/bin/tini", "--", "node", "dist/cli.js"]
CMD ["render", "-"]
