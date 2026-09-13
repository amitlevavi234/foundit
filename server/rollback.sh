#!/usr/bin/env bash
# ===========================================================================
# Undo a deploy. Two kinds of undo, and choosing the wrong one loses data.
#
#   server/rollback.sh                    the code was wrong  (§4.4 scenario B)
#   server/rollback.sh --restore-database the MIGRATION was wrong (scenario C)
#
# research/10 §4.4. Read the distinction before running either:
#
#   SCENARIO B — the migration was fine and the new code is broken. With
#   expand-then-contract migrations the OLD code still works against the NEW
#   schema, so the fix is to put the previous image tag back and leave the
#   database alone. This is the default, it takes about ten seconds, and it is
#   what `server/deploy.sh` already does by itself when health never comes.
#
#   SCENARIO C — the migration itself destroyed or corrupted data. Only then is
#   the pre-migration dump restored, and it is restored INTO A SCRATCH DATABASE
#   and swapped in by RENAME. Nothing is dropped, here or ever: the broken
#   database is renamed aside and kept, because the rows written between the
#   migration and the moment somebody noticed exist only in it.
#
# THE FIRST THING EITHER BRANCH DOES IS STOP WRITES, because every second of
# continued writing makes a restore lossier.
# ===========================================================================
set -euo pipefail

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

foundit_refuse_root
foundit_set_sudo

# `$SUDO` in front for the same reason deploy.sh has one: compose is what reads
# the root-only env file. On the development machine SUDO is empty.
DC=($SUDO docker compose --project-directory "$(dirname "$COMPOSE_FILE")" -f "$COMPOSE_FILE")

RESTORE_DB=""
TAG_ARG=""
for arg in "$@"; do
  case "$arg" in
    --restore-database) RESTORE_DB="yes" ;;
    sha-*) TAG_ARG="$arg" ;;
    *) echo "unknown argument: $arg" >&2; exit 64 ;;
  esac
done

# Which tag to go back to. An explicit one wins; otherwise the one deploy.sh
# recorded. Validated with the same pattern deploy.sh validates its argument
# with, because this is the other place a tag becomes a `docker run`.
TARGET="${TAG_ARG:-$(cat "$STATE_DIR/previous_tag" 2>/dev/null || echo "")}"
if ! printf '%s' "$TARGET" | grep -Eq '^sha-[0-9a-f]{7,40}$'; then
  echo "refusing: no previous tag recorded and none given." >&2
  echo "usage: server/rollback.sh [sha-1a2b3c4] [--restore-database]" >&2
  echo "       $STATE_DIR/previous_tag is where deploy.sh writes one." >&2
  exit 64
fi

if ! foundit_file_exists "$ENV_DIR/app.env"; then
  echo "refusing: $ENV_DIR/app.env does not exist." >&2
  exit 78
fi

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
say "$(date -u +%FT%TZ) — rolling back to ${TARGET}"

export FOUNDIT_ENV_DIR="$ENV_DIR"

# --- STOP WRITES -----------------------------------------------------------
#
# The app only. The database keeps running: it holds what is being rescued,
# and both branches below read from it.
say "stopping the application (the database keeps running)"
"${DC[@]}" stop app worker >/dev/null 2>&1 || true

if [ -n "$RESTORE_DB" ]; then
  # ==================== SCENARIO C ====================
  DUMP="${FOUNDIT_DUMP:-$BACKUP_DIR/latest-pre-deploy.dump}"
  [ -f "$DUMP" ] || { echo "!! no dump at $DUMP" >&2; ls -lt "$BACKUP_DIR" >&2 || true; exit 71; }

  PSQL=($SUDO docker exec -i -u postgres "$DB_CONTAINER" psql -v ON_ERROR_STOP=1 -qXAt)

  # 1. Snapshot the CURRENT, broken database first. Rows written after the bad
  #    migration exist nowhere else, and they are usually the ones somebody
  #    cares about.
  BROKEN="$BACKUP_DIR/BROKEN-${STAMP}.dump"
  say "snapshotting the current (broken) database -> $(basename "$BROKEN")"
  $SUDO docker exec -i -u postgres "$DB_CONTAINER" \
    pg_dump -d "$DB_NAME" -Fc --no-owner --no-privileges > "$BROKEN"
  [ -s "$BROKEN" ] || { echo "!! could not snapshot the broken database; stopping" >&2; exit 71; }

  # 2. Restore into a SCRATCH database. Never over production on the first try.
  say "restoring $(basename "$DUMP") into ${DB_NAME}_restore"
  "${PSQL[@]}" -d postgres -c "drop database if exists ${DB_NAME}_restore" >/dev/null
  "${PSQL[@]}" -d postgres -c "create database ${DB_NAME}_restore owner foundit_owner" >/dev/null
  $SUDO docker exec -i -u postgres "$DB_CONTAINER" \
    pg_restore -d "${DB_NAME}_restore" --no-owner --no-privileges < "$DUMP" \
    || echo "   (pg_restore reported warnings; the counts below are the test)"

  # 3. Count it. A restore that "succeeded" into an empty database is the
  #    failure mode research/08 §5.8 exists to catch.
  say "row counts in the restored copy"
  "${PSQL[@]}" -d "${DB_NAME}_restore" -c "
    select 'tools=' || count(*) from public.tools
    union all select 'published=' || count(*) from public.tools where status = 'published'
    union all select 'statements=' || count(*) from public.tool_problems
    union all select 'reviews=' || count(*) from public.reviews"

  TOOLS="$("${PSQL[@]}" -d "${DB_NAME}_restore" -c 'select count(*) from public.tools')"
  if [ "${TOOLS:-0}" -lt 1 ]; then
    echo "!! the restored copy has no tools in it. NOT swapping it in." >&2
    echo "   ${DB_NAME}_restore is left in place for you to look at." >&2
    exit 71
  fi

  # 4. STOP. Everything above this line is reversible; the rename is not.
  if [ "${FOUNDIT_ROLLBACK_CONFIRM:-}" != "yes" ]; then
    cat >&2 <<STOPHERE

STOP. The restored copy is in ${DB_NAME}_restore and has ${TOOLS} tools.
Nothing has been swapped. To swap it in, rename by hand or re-run with:

    FOUNDIT_ROLLBACK_CONFIRM=yes server/rollback.sh ${TARGET} --restore-database

That step renames ${DB_NAME} to ${DB_NAME}_broken_${STAMP} and keeps it.
Nothing is dropped. Read docs/launch-runbook.md before you do it.
STOPHERE
    exit 3
  fi

  # 5. Swap by RENAME, never by DROP.
  say "renaming ${DB_NAME} -> ${DB_NAME}_broken_${STAMP}, and the copy into place"
  "${PSQL[@]}" -d postgres -c \
    "alter database ${DB_NAME} rename to ${DB_NAME}_broken_${STAMP}" >/dev/null
  "${PSQL[@]}" -d postgres -c \
    "alter database ${DB_NAME}_restore rename to ${DB_NAME}" >/dev/null
  say "the broken database is kept as ${DB_NAME}_broken_${STAMP}. Do not drop it for a week."
fi

# --- put the previous image back -------------------------------------------
say "starting ${TARGET}"
IMAGE_TAG="$TARGET" "${DC[@]}" up -d --wait --wait-timeout 120 --remove-orphans

say "waiting for ${HEALTH_URL}"
ok=""
for i in $(seq 1 40); do
  code="$(curl -fsS -o /dev/null -w '%{http_code}' --max-time 5 "$HEALTH_URL" 2>/dev/null || echo 000)"
  if [ "$code" = "200" ]; then ok="yes"; say "healthy after ${i} attempt(s)"; break; fi
  sleep 3
done
if [ -z "$ok" ]; then
  echo "!! ${TARGET} is not healthy either. Its last 40 log lines:" >&2
  "${DC[@]}" logs --tail=40 app >&2 || true
  echo "!! docs/launch-runbook.md, 'when the rollback does not come back' " >&2
  exit 75
fi

mkdir -p "$STATE_DIR"
printf '%s\n' "$TARGET" > "$STATE_DIR/current_tag"
printf '%s  ROLLED BACK  -> %s%s\n' "$(date -u +%FT%TZ)" "$TARGET" \
  "${RESTORE_DB:+ (database restored)}" >> "$STATE_DIR/deploy.log"
say "rolled back to ${TARGET}"
