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
#   1c. TAKE THE LOCK, before the environment and before `docker info`. One
#      deploy at a time, or `current_tag` ends up naming an image that is not
#      running — see foundit_take_deploy_lock in common.sh
#   2. no-op if that tag is already running and healthy
#   3. pull  — a failed pull leaves the running stack untouched
#   4. pg_dump BEFORE any migration runs (research/10 §4.3)
#   5. migrations, as foundit_owner, out of the NEW image
#   6. start the new container
#   7. wait for /healthz; if it never comes, put the previous tag back
#   7b. and prove the worker is really up, which is a 60-second question
#
# WHAT EACH EXIT CODE MEANS, because two of them now say WHICH HALF failed:
#
#   64  the tag is not sha-<hex>            nothing was touched
#   70  the pull failed                     nothing was touched
#   71  the pre-migration dump is bad       nothing was migrated
#   72  a migration failed                  the old container is still serving
#   75  health never came, or another       the previous tag is back, or the
#       deploy holds the lock               other deploy owns the machine
#   76  THE APP IS UP AND THE WORKER IS NOT the site is serving and nothing new
#                                           becomes searchable. NOT rolled back
#   77  run as root                         nothing was touched
#   78  an env file is missing or is not    nothing was touched
#       mode 0600
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
#
# The check itself is `foundit_tag_ok` in common.sh — one copy, shared with
# rollback.sh, `case` rather than `grep`. The Phase 9a review's F10 is written
# up there: `grep` matches line by line, so a string whose SECOND line was a
# valid tag used to get past this and reach `docker compose pull`.
TAG="${1:-}"
foundit_tag_ok "$TAG" || {
  echo "refusing: the tag must look like sha-<hex>, got '${TAG}'" >&2
  echo "usage: server/deploy.sh sha-1a2b3c4" >&2
  exit 64
}

# --- 1c. THE LOCK, and it is this early on purpose -------------------------
#
# BEFORE THE ENVIRONMENT, BEFORE `docker info`, BEFORE ANYTHING THAT CAN FAIL
# FOR A REASON THAT IS NOT "SOMEBODY ELSE IS DEPLOYING". The Phase 9a review's
# F3 is the reason there is a lock at all; the reason it is HERE rather than
# after the checks is a CI run that failed the test for it.
#
# A `deploy.sh` that dies at its first docker call — no daemon on the runner,
# no env file, the wrong container name — used to hold the lock for a few
# milliseconds and release it on the way out. On a machine where the first
# check fails fast, two runs started together therefore BOTH proceeded: the
# second took the lock the first had already dropped. The window was small and
# the failure it left is the one F3 describes, so it is not a window worth
# having. Taken here, the lock is held for every line of the run that can do
# anything, including the ones that refuse.
#
# The tag check stays in front of it because it costs nothing, touches nothing,
# and a run that is about to exit 64 has no business holding a lock the
# operator's next attempt needs.
mkdir -p "$STATE_DIR" 2>/dev/null || {
  echo "refusing: $STATE_DIR could not be created." >&2
  echo "   It holds current_tag, previous_tag and deploy.log, and it is where the" >&2
  echo "   one-deploy-at-a-time lock lives. On the host it is /srv/foundit/state;" >&2
  echo "   elsewhere, set FOUNDIT_BASE to a directory this account can write to." >&2
  exit 78
}
foundit_take_deploy_lock "$STATE_DIR"

# --- 1d. sudo, and the compose command it builds ---------------------------
#
# `foundit_set_sudo` ASKS THE DAEMON — `docker info`, then `sudo -n true` — so
# it is the first thing in this script that talks to anything, and it is after
# the lock for that reason.
#
# `$SUDO` in front, because compose is the thing that READS app.env and
# embed.env, and those are root-only. On this development machine SUDO is
# empty and this is `docker compose` exactly as typed.
foundit_set_sudo
DC=($SUDO docker compose --project-directory "$(dirname "$COMPOSE_FILE")" -f "$COMPOSE_FILE")

# --- 1c. the env files -----------------------------------------------------
#
# Named, checked for existence AND MODE, and NEVER read by this script. What
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
#
# THE MODE CHECK IS REAL NOW AND USED TO BE A SENTENCE. That is the Phase 9a
# review's F11: this comment said "checked for existence and mode" and the loop
# called only `foundit_file_exists`, and four full deploy runs in that review
# used all three files at 0644 without a word. `foundit_file_mode` asks
# `stat -c %a` through `$SUDO`, because founditops cannot stat a root-only file
# either, and prints the mode — never the contents.
#
# 0600 AND NOTHING LOOSER. Not "not world-readable": every account on this box
# is in the docker group or is root, and `docker run --env-file` hands the
# whole file to a container. `docs/launch-runbook.md` step 1e creates all four
# with `sudo install -m 600 /dev/null`, so a file at any other mode was edited
# by hand and is worth stopping for.
CHECK_MODES="yes"
if ! foundit_modes_enforced; then
  CHECK_MODES=""
  warn "this filesystem does not enforce file modes, so the 0600 check is NOT being made."
  warn "That is true of Git Bash on the development machine and of nothing on the host."
fi

for name in app.env embed.env migrate.env; do
  file="$ENV_DIR/$name"
  if ! foundit_file_exists "$file"; then
    echo "refusing: $file does not exist." >&2
    echo "docs/launch-runbook.md step 1 is where it is created." >&2
    exit 78
  fi
  [ -n "$CHECK_MODES" ] || continue
  mode="$(foundit_file_mode "$file")"
  if [ -z "$mode" ]; then
    echo "refusing: $file exists and its mode cannot be read." >&2
    exit 78
  fi
  if [ "$mode" != "600" ]; then
    echo "refusing: $file is mode ${mode}, not 600." >&2
    echo "   It holds a credential and this machine's other accounts are in the" >&2
    echo "   docker group. Fix it with: sudo chmod 600 $file" >&2
    exit 78
  fi
done

mkdir -p "$BACKUP_DIR"

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
# exactly that. It is started, it is checked at §9, and a worker that never
# comes up is a FAILED deploy of a running site (exit 76) rather than a
# rollback.
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

# --- 8. record it ----------------------------------------------------------
#
# BEFORE THE WORKER CHECK, AND THAT IS THE DECISION F4 TURNS ON. The app is up
# and healthy; whatever the worker does next, THIS TAG IS WHAT IS RUNNING, and
# `current_tag` must say so or the next `rollback.sh` goes somewhere nobody
# asked for. A worker that cannot start is a loud failure of the deploy and is
# not a reason to serve a different image.
[ -n "$PREV_TAG" ] && printf '%s\n' "$PREV_TAG" > "$STATE_DIR/previous_tag"
printf '%s\n' "$TAG" > "$STATE_DIR/current_tag"
printf '%s  DEPLOYED  %s -> %s\n' "$(date -u +%FT%TZ)" "${PREV_TAG:-none}" "$TAG" \
  >> "$STATE_DIR/deploy.log"

# --- 8b. housekeeping ------------------------------------------------------
#
# Fourteen days of pre-deploy dumps, dangling layers, and this repository's own
# old tags — never the two the state directory names.
#
# THE PHASE 9a REVIEW'S F23. This was `docker image prune -af --filter
# "until=336h"`, which removes every image no container references and older
# than fourteen days — INCLUDING the image `previous_tag` names, once the
# current tag has been running a fortnight. `pull_policy: missing` then means
# `rollback.sh` has to reach GHCR at exactly the moment somebody is rolling
# back, on a box whose only way out is the same tunnel that is probably having
# the bad day. That is the wrong dependency to acquire silently.
#
# So: `-f` and not `-af`, which touches only DANGLING layers and can never take
# a tagged image; and then this repository's own tags, explicitly, skipping the
# two that are still reachable. Nothing else on the machine is this script's
# business.
#
# NEVER `docker system prune --volumes`: research/08 §8.1 and research/10 §6.3
# both say so, and the volume it would take is the database.
$SUDO docker image prune -f --filter "until=336h" >/dev/null 2>&1 || true
REPO="${FOUNDIT_IMAGE_REPO:-ghcr.io/amitlevavi234/foundit}"
KEEP_CURRENT="$($SUDO docker images -q "${REPO}:${TAG}" 2>/dev/null | head -1)"
KEEP_PREVIOUS=""
[ -n "$PREV_TAG" ] && KEEP_PREVIOUS="$($SUDO docker images -q "${REPO}:${PREV_TAG}" 2>/dev/null | head -1)"
for old in $($SUDO docker images -q --filter "reference=${REPO}" \
              --filter "before=${REPO}:${TAG}" 2>/dev/null); do
  [ "$old" = "$KEEP_CURRENT" ] && continue
  [ "$old" = "$KEEP_PREVIOUS" ] && continue
  $SUDO docker rmi "$old" >/dev/null 2>&1 || true
done
find "$BACKUP_DIR" -name 'pre-*.dump' -mtime +14 -delete 2>/dev/null || true

say "deployed ${TAG}"

# --- 9. and prove the worker really came with it ---------------------------
#
# THE PHASE 9a REVIEW'S F4, AND THE LINE THIS REPLACES WAS WRITTEN FOR EXACTLY
# THE FAILURE IT DID NOT CATCH. It was `sleep 3` and then
# `docker inspect -f '{{.State.Running}}' foundit-worker | grep -q true`, and
# at t+3s a container in `restarting` state reports `Running=true`. The review
# started a worker with no key — the same class of failure as the implementer's
# own found-by-running note #1, a flag that never existed — and watched this
# print "the embed worker is running" ELEVEN SECONDS BEFORE the container was
# dead for good. `restart: on-failure:3` had already spent every restart it was
# allowed.
#
# So three changes, and each answers one half of that:
#
#   `.State.Status`, not `.State.Running`   `restarting` is not `running`, and
#                                           only the first of those two says
#                                           which it is.
#   `.RestartCount` must be 0               a worker that has already died once
#                                           at start-up is a worker that is
#                                           crash-looping, whatever it is doing
#                                           at the moment we look.
#   settle 20s, then poll to 60s            longer than Docker's restart
#                                           backoff, so "up now" means up.
#
# AND IT IS A FAILED DEPLOY, WITH THE APP LEFT RUNNING. Not a rollback: the
# site is healthy and putting the previous image back would take a good site
# down for a queue. Not a warning either — the script's own comment names the
# cost ("a site with no embed worker looks perfectly well and stops making
# anything new searchable, which is the kind of outage nobody notices for a
# week") and a warning at the end of a green transcript is how that week
# starts. Exit 76, which is this script's code for "the app is up and the
# worker is not".
say "waiting for the embed worker to settle"
sleep 20
worker_ok=""
worker_state=""
for i in $(seq 1 14); do
  status="$(docker inspect -f '{{.State.Status}}' foundit-worker 2>/dev/null || echo "absent")"
  restarts="$(docker inspect -f '{{.RestartCount}}' foundit-worker 2>/dev/null || echo "?")"
  worker_state="status=${status} restarts=${restarts}"
  if [ "$status" = "running" ] && [ "$restarts" = "0" ]; then
    worker_ok="yes"
    say "the embed worker is running (${worker_state}, after $(( 20 + (i - 1) * 3 ))s)"
    break
  fi
  sleep 3
done

if [ -z "$worker_ok" ]; then
  echo "!! THE EMBED WORKER DID NOT COME UP: ${worker_state}" >&2
  echo "!! The site IS up and serving ${TAG}, and it has NOT been rolled back." >&2
  echo "   Nothing new becomes searchable until the worker runs. Its last lines:" >&2
  "${DC[@]}" logs --tail=20 worker >&2 || true
  echo "!! exit 76: the app half succeeded and the worker half did not." >&2
  echo "   docs/launch-runbook.md, 'the site is up and nothing new becomes searchable'." >&2
  printf '%s  WORKER FAILED  %s  %s\n' "$(date -u +%FT%TZ)" "$TAG" "$worker_state" \
    >> "$STATE_DIR/deploy.log"
  exit 76
fi
