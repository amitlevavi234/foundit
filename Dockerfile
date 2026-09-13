# syntax=docker/dockerfile:1
# ===========================================================================
# Foundit, packaged for the host.
#
# research/10 §6.6's Dockerfile, with four deliberate differences, each of
# which is a fact about this repository rather than a preference:
#
#   1. node:26, not node:22. package.json says `"node": ">=26.0.0"`, and the
#      application uses `node --env-file` and a test runner that needs it.
#      Pinned by DIGEST as well as by tag, because a tag is a moving target
#      and research/07 §4.6 is right that a server with perfect unattended
#      upgrades and a floating base image is not patched, it is unmeasured.
#
#   2. `npm run build` does its own postbuild. research/10's runner stage
#      copies `public/` and `.next/static` into the standalone directory by
#      hand; scripts/postbuild-standalone.mjs already does exactly that, at
#      `next build` time, so a local `npm start` and this image package the
#      same bytes. The COPY lines below are therefore one directory rather
#      than three, and the knowledge lives in the script.
#
#   3. NO `SENTRY_AUTH_TOKEN`, NO SOURCE-MAP UPLOAD. research/10 §7.2 passes
#      one as a BuildKit secret so Sentry can un-minify a stack trace. That
#      needs a Sentry account at BUILD time, which would put a credential in
#      the CI that builds this image for the sake of prettier stack traces.
#      `next.config.mjs` sets `sourcemaps.disable`, the image ships no maps,
#      and a stack trace in Sentry names minified frames. That is the trade,
#      and 9b may revisit it with the owner's token.
#
#   4. NO `NEXT_PUBLIC_*` BUILD ARG for the site's own address. research/10
#      §2.5 bakes one in and notes it forces separate images per environment.
#      Nothing in this application reads its own URL from the client bundle:
#      `BETTER_AUTH_URL` is read on the server at request time, so ONE image
#      runs anywhere. The one `NEXT_PUBLIC_` variable that exists — the
#      Cloudflare Web Analytics site token — is an optional build arg below,
#      and it is a public site identifier rather than a secret.
#
# NOTHING SECRET ENTERS ANY LAYER. No `.env` is copied (.dockerignore refuses
# it), no ARG carries a key, and the runtime reads every credential from the
# env file `server/compose.prod.yml` names, which lives at /root/.foundit on
# the host and is never in the image. tests/deploy.test.mjs greps this file.
# ===========================================================================

# --- dependencies ----------------------------------------------------------
FROM node:26-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# `npm ci --ignore-scripts`: the only packages in this tree with install
# scripts are Sentry's CLI and a resolver, and neither is needed to run.
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts

# --- build -----------------------------------------------------------------
FROM node:26-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ARG NEXT_PUBLIC_CF_BEACON_TOKEN=""
ENV NEXT_PUBLIC_CF_BEACON_TOKEN=$NEXT_PUBLIC_CF_BEACON_TOKEN
# `next build` writes .next/standalone; the repo's own postbuild step packages
# .next/static and public/ into it (scripts/postbuild-standalone.mjs).
RUN npm run build

# --- run -------------------------------------------------------------------
FROM node:26-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# node:alpine already ships a `node` user at 1000. A second, named one, so the
# process has no shell and owns nothing it did not need to own.
RUN addgroup -g 1001 -S foundit && adduser -S -G foundit -u 1001 foundit

# One directory. scripts/postbuild-standalone.mjs put everything in it.
COPY --from=builder --chown=foundit:foundit /app/.next/standalone ./

# The migrations travel WITH the image, so `server/deploy.sh` applies exactly
# the migrations the code being deployed expects, out of the same artefact,
# rather than out of whatever the host's checkout happens to be at.
COPY --from=builder --chown=foundit:foundit /app/db/migrations ./db/migrations
COPY --from=builder --chown=foundit:foundit /app/db/apply.mjs ./db/apply.mjs

# The embed worker is the second service in server/compose.prod.yml: same
# image, different command.
COPY --from=builder --chown=foundit:foundit /app/scripts ./scripts
COPY --from=builder --chown=foundit:foundit /app/lib ./lib

USER foundit
EXPOSE 3000

# EXEC form, so node is PID 1 and receives SIGTERM. research/10 §3.1: in shell
# form the executable is not PID 1 and "will not receive Unix signals", so a
# deploy kills in-flight requests instead of draining them.
#
# `server.js` and not `scripts/start.mjs`: that script exists to stop `npm
# start` on a laptop binding every interface, and here binding 0.0.0.0 is what
# is wanted — the container's every interface is the container.
CMD ["node", "server.js"]
