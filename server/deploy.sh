#!/usr/bin/env bash
# ===========================================================================
# Deploy one image tag. Idempotent, and it undoes itself when health does not
# come.
#
#   server/deploy.sh sha-1a2b3c4
#
# research/10 §2.3 and §4, adapted to this host. The differences from the
# researched script are all consequences of two facts about this machine:
# PostgreSQL is a SERVICE of its own here rather than a service of this compose
# project, and there is no reverse proxy, so health is asked on the loopback
# port the tunnel dials.
#
# THE ORDER IS THE WHOLE POINT, and every step before the last is reversible:
#
#   1. refuse to run as root, and refuse a tag that is not sha-<hex>
#   2. no-op if that tag is already running and healthy
#   3. pull  — a failed pull leaves the running stack untouched
#   4. pg_dump BEFORE any migration runs (research/10 §4.3)
#   5. migrations, as foundit_owner, out of the NEW image
#   6. start the new container
#   7. wait for /healthz; if it never comes, put the previous tag back
#
# WHAT IT NEVER PRINTS. No connection string, no password, no env file, no
# `docker compose config` (which expands every env file into stdout and is,
# per research/07 §6.2, the likeliest way a production password ends up in a
# chat window). tests/deploy.test.mjs runs this script with a fake env file
# full of recognisable values and greps every line of its output for them.
# ===========================================================================
set -euo pipefail

# --- where things are ------------------------------------------------------
# Overridable so that tests/deploy.test.mjs and the development machine can
# exercise this script end to end without a /srv or a /root to write to. On the
# host every one of these is the default.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=server/common.sh
. "$HERE/common.sh"
COMPOSE_FILE="${FOUNDIT_COMPOSE_FILE:-$HERE/compose.prod.yml}"
ENV_DIR="${FOUNDIT_ENV_DIR:-/root/.foundit}"
BASE="${FOUNDIT_BASE:-/srv/foundit}"
STATE_DIR="$BASE/state"
BACKUP_DIR="$BASE/backups"
DB_CONTAINER="${FOUNDIT_DB_CONTAINER:-foundit-dev-db}"
DB_NAME="${FOUNDIT_DB_NAME:-foundit}"
HEALTH_URL="${FOUNDIT_HEALTH_URL:-http://127.0.0.1:3000/healthz}"
HEALTH_TRIES="${FOUNDIT_HEALTH_TRIES:-40}"

# --- 1a. not as root -------------------------------------------------------
#
# A deploy needs the docker group and the ability to read one root-only file.
# It does not need to BE root, and running it as root means every mistake in it
# — a bad path in an `rm`, a `>` that lands on the wrong file — is unbounded.
# So: refuse, and use sudo for the two steps that actually need it.
#
# `id -u` is 0 only on a real Unix root. On the development machine under Git
# Bash it is not, sudo is absent, and SUDO stays empty — which is how this same
# script is exercised there.
foundit_refuse_root
foundit_set_sudo

# `$SUDO` in front, because compose is the thing that READS app.env and
# embed.env, and those are root-only. On this development machine SUDO is
# empty and this is `docker compose` exactly as typed.
DC=($SUDO docker compose --project-directory "$(dirname "$COMPOSE_FILE")" -f "$COMPOSE_FILE")

# --- 1b. the tag -----------------------------------------------------------
#
# `sha-<7 to 40 hex>` AND NOTHING ELSE. Not `latest`, not a branch name, not a
# tag somebody typed. Three reasons, and the third is the one that matters:
#
#   a moving tag cannot be rolled back to — `previous_tag` would name the same
#   bytes as `current_tag`;
#   a tag with a slash or a `..` in it reaches a different repository;
#   and this argument arrives from a CI job over a channel whose whole security
#   is that the thing on the far end can only ask for a redeploy. A validated
#   tag is what keeps "trigger a deploy" from becoming "run this image".
TAG="${1:-}"
if ! printf '%s' "$TAG" | grep -Eq '^sha-[0-9a-f]{7,40}$'; then
  echo "refusing: the tag must look like sha-<hex>, got '${TAG}'" >&2
  echo "usage: server/deploy.sh sha-1a2b3c4" >&2
  exit 64
fi

# --- 1c. the env files -----------------------------------------------------
#
# Named, checked for existence and mode, and NEVER read by this script. What
# reads app.env is compose; what reads migrate.env is the one `docker run`
# below. Nothing here opens either, so nothing here can print one.
#
# THREE FILES AND NOT ONE, and the split is a privilege boundary rather than
# tidiness:
#   app.env       foundit_app, foundit_auth, the session secret, the mail key
#   embed.env     foundit_embed and the embeddings key, and nothing else
#   migrate.env   DATABASE_URL_OWNER — the ONLY place the owner's credentials
#                 exist on this machine outside the database itself. The
#                 application must never be able to read it: lib/db.ts throws
#                 if DATABASE_URL names foundit_owner, and this is the other
#                 half of that check.
for name in app.env embed.env migrate.env; do
  file="$ENV_DIR/$name"
  if ! foundit_file_exists "$file"; then
    echo "refusing: $file does not exist." >&2
    echo "docs/launch-runbook.md step 1 is where it is created." >&2
    exit 78
  fi
done

mkdir -p "$STATE_DIR" "$BACKUP_DIR"
PREV_TAG="$(cat "$STATE_DIR/current_tag" 2>/dev/null || echo "")"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

say() { printf '==> %s\n' "$*"; }
say "deploying ${TAG} (previous: ${PREV_TAG:-none})"

export IMAGE_TAG="$TAG"
export FOUNDIT_ENV_DIR="$ENV_DIR"

# --- 2. idempotency --------------------------------------------------------
#
# The same tag, already up and already healthy, is not a deploy. Re-running
# this after a network hiccup must not take a second dump, re-run migrations
# and restart the site.
healthy_now() {
  docker inspect -f '{{.State.Health.Status}}' foundit-app 2>/dev/null | grep -q '^healthy$'
}
if [ "$TAG" = "$PREV_TAG" ] && healthy_now; then
  say "${TAG} is already deployed and healthy; nothing to do"
  exit 0
fi

# --- 3. pull ---------------------------------------------------------------
#
# FIRST, and on its own. A tag that does not exist, a registry that is down or
# a disk that is full must all fail here, with the current site still serving.
say "pulling the image"
if ! "${DC[@]}" pull --quiet app; then
  echo "!! pull failed; the running stack was not touched" >&2
  exit 70
fi

# --- 4. the dump, BEFORE the migrations ------------------------------------
#
# research/10 §4.3. `-Fc` so a single table can be pulled back out of it,
# `--no-owner --no-privileges` so it restores into a differently-named role on
# a fresh box, and `-T` on `exec` because a TTY corrupts the binary stream in a
# way that is only discovered on the day it is needed.
#
# AND IT IS CHECKED TWICE: not empty, and structurally readable. `pg_restore
# -l` fails loudly on a truncated file, which `test -s` does not.
DUMP="$BACKUP_DIR/pre-${STAMP}-${TAG}.dump"
say "pre-migration dump -> $(basename "$DUMP")"
$SUDO docker exec -i -u postgres "$DB_CONTAINER" \
  pg_dump -d "$DB_NAME" -Fc --no-owner --no-privileges > "$DUMP"
if [ ! -s "$DUMP" ]; then
  echo "!! the pre-migration dump is empty; refusing to migrate" >&2
  rm -f "$DUMP"
  exit 71
fi
# `pg_restore -l` WITH NO FILE ARGUMENT, reading stdin. Naming `/dev/stdin`
# instead looks equivalent and is not: pg_restore seeks in the file it is
# given, the container's /dev/stdin is a pipe, and it then reports "did not
# find magic string in file header" on a dump that is perfectly good — a check
# that fails on every healthy backup is worse than no check at all.
$SUDO docker exec -i -u postgres "$DB_CONTAINER" pg_restore -l < "$DUMP" > /dev/null \
  || { echo "!! the pre-migration dump is not readable; refusing to migrate" >&2; exit 71; }
ln -sfn "$DUMP" "$BACKUP_DIR/latest-pre-deploy.dump" 2>/dev/null || true
say "dump is $(wc -c < "$DUMP") bytes and pg_restore can read it"

# --- 5. migrations, as the owner, out of the new image ---------------------
#
# OUT OF THE IMAGE BEING DEPLOYED, not out of a checkout on the host. The
# migrations a build expects are the ones that were in the tree it was built
# from, and a host checkout drifts. The Dockerfile copies db/migrations and
# db/apply.mjs for exactly this.
#
# `--network` is the database project's own bridge, because 127.0.0.1 in a
# container is the container (see server/compose.prod.yml's networks block).
#
# A FAILED MIGRATION STOPS HERE, with the old container still serving and the
# dump on disk. That is research/10 §4.4 scenario A, and there is nothing to
# undo: `db/apply.mjs` runs each file in a transaction.
say "applying migrations as foundit_owner"
if ! $SUDO docker run --rm \
      --network "${FOUNDIT_DB_NETWORK:-foundit-db_default}" \
      --env-file "$ENV_DIR/migrate.env" \
      --entrypoint node \
      "${FOUNDIT_IMAGE_REPO:-ghcr.io/amitlevavi234/foundit}:${TAG}" \
      db/apply.mjs; then
  echo "!! the migrations failed. The previous container is still serving." >&2
  echo "   The pre-migration dump is $DUMP" >&2
  echo "   research/10 §4.4 scenario A: read the error, fix the migration." >&2
  exit 72
fi

# --- 6 and 7. start it, and wait for it to say it is well ------------------
#
# `--wait` is the load-bearing flag (research/10 §2.3): without it `up -d`
# returns when the container is CREATED, so a crash-looping app reports
# success. With it, plus the healthcheck in the compose file, "deploy" becomes
# "deploy or roll back".
rollback_to_previous() {
  echo "!! the new tag never became healthy" >&2
  if [ -z "$PREV_TAG" ]; then
    echo "!! and there is no previous tag to go back to. The stack is down." >&2
    echo "   The database HAS been migrated; the dump is $DUMP" >&2
    return 75
  fi
  echo "!! putting ${PREV_TAG} back" >&2
  IMAGE_TAG="$PREV_TAG" "${DC[@]}" up -d --wait --wait-timeout 120 --remove-orphans || true
  printf '%s  ROLLED BACK  %s -> %s\n' "$(date -u +%FT%TZ)" "$TAG" "$PREV_TAG" \
    >> "$STATE_DIR/deploy.log"
  return 75
}

# THE APP IS WHAT THE DEPLOY WAITS ON, AND THE WORKER IS NOT, which is a
# decision rather than an oversight. The worker embeds statements from a queue;
# the site serves pages. A worker that cannot start — no key, a provider
# outage, the advisory lock held by a process somebody left running — must not
# roll back a perfectly good site, and `--wait` over both services would do
# exactly that. It is started, it is checked, and a worker that is not running
# is a loud line rather than a rollback.
say "starting ${TAG}"
if ! "${DC[@]}" up -d --wait --wait-timeout 120 --remove-orphans app; then
  rollback_to_previous || exit 75
  exit 75
fi
"${DC[@]}" up -d worker >/dev/null 2>&1 || true

say "waiting for ${HEALTH_URL}"
ok=""
for i in $(seq 1 "$HEALTH_TRIES"); do
  code="$(curl -fsS -o /dev/null -w '%{http_code}' --max-time 5 "$HEALTH_URL" 2>/dev/null || echo 000)"
  if [ "$code" = "200" ]; then ok="yes"; say "healthy after ${i} attempt(s)"; break; fi
  sleep 3
done
if [ -z "$ok" ]; then
  echo "--- the new container's last 40 log lines ---" >&2
  "${DC[@]}" logs --tail=40 app >&2 || true
  rollback_to_previous || exit 75
  exit 75
fi

# --- 7b. and say whether the worker came with it ---------------------------
#
# Not a failure, and not silence either. A site with no embed worker looks
# perfectly well and stops making anything new searchable, which is the kind of
# outage nobody notices for a week.
sleep 3
if docker inspect -f '{{.State.Running}}' foundit-worker 2>/dev/null | grep -q true; then
  say "the embed worker is running"
else
  echo "!! THE EMBED WORKER IS NOT RUNNING. The site is up and new listings will" >&2
  echo "   not become searchable until it is. Its last lines:" >&2
  "${DC[@]}" logs --tail=12 worker >&2 || true
fi

# --- 8. record it ----------------------------------------------------------
[ -n "$PREV_TAG" ] && printf '%s\n' "$PREV_TAG" > "$STATE_DIR/previous_tag"
printf '%s\n' "$TAG" > "$STATE_DIR/current_tag"
printf '%s  DEPLOYED  %s -> %s\n' "$(date -u +%FT%TZ)" "${PREV_TAG:-none}" "$TAG" \
  >> "$STATE_DIR/deploy.log"
say "deployed ${TAG}"

# --- 9. housekeeping -------------------------------------------------------
#
# Fourteen days of pre-deploy dumps and two weeks of unreferenced images.
# NEVER `docker system prune --volumes`: research/08 §8.1 and research/10 §6.3
# both say so, and the volume it would take is the database.
docker image prune -af --filter "until=336h" >/dev/null 2>&1 || true
find "$BACKUP_DIR" -name 'pre-*.dump' -mtime +14 -delete 2>/dev/null || true
