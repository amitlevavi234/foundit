#!/usr/bin/env bash
# ===========================================================================
# The nightly logical backup. research/08 §5.4.
#
#   server/backup/pg-dump-offsite.sh
#
# DELIBERATELY NOT pgBackRest, and that is the point of having both. pgBackRest
# does physical backups and WAL archiving; this is `pg_dump`, a different tool
# writing a different format through a different code path. A pgBackRest-shaped
# failure — a bad stanza, a cipher passphrase nobody can find, a version of the
# tool that cannot read its own repository — cannot take this out at the same
# time. Two backups that fail the same way are one backup.
#
# WHAT IT DOES, in order, and the order is the safety:
#
#   1. pg_dumpall --globals-only    roles and grants. `pg_dump` does not carry
#                                   them, and a restore without them is a
#                                   database nothing can log in to.
#   2. pg_dump -Fc                  the database, compressed, restorable one
#                                   table at a time.
#   3. pg_restore -l                PROVE IT IS READABLE before trusting it.
#                                   `test -s` passes on a truncated file.
#   4. a size floor                 a dump under the floor means something
#                                   went wrong. Fail loudly; do not upload.
#   5. encrypt                      with the public half of an age key whose
#                                   private half is not on this machine.
#   6. put it in the repository     a directory, or an S3-compatible bucket.
#   7. forget the old ones
#   8. ping the dead man's switch   ONLY here, at the end, on success.
#
# NO CREDENTIAL IS EVER PRINTED. The settings come from an env file this script
# sources and never echoes; the S3 secret goes to the AWS CLI through the
# environment; and every path printed below is a basename.
# ===========================================================================
set -Eeuo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_DIR="${FOUNDIT_ENV_DIR:-/root/.foundit}"
ENV_FILE="${FOUNDIT_BACKUP_ENV:-$ENV_DIR/backup.env}"
DB_CONTAINER="${FOUNDIT_DB_CONTAINER:-foundit-dev-db}"
DB_NAME="${FOUNDIT_DB_NAME:-foundit}"
DB_SUPERUSER="${FOUNDIT_DB_SUPERUSER:-postgres}"
# A dump smaller than this means pg_dump wrote a header and gave up. The
# production floor is set in backup.env; the default is low enough for the
# development catalogue and high enough to catch an empty file.
MIN_BYTES="${BACKUP_MIN_BYTES:-20000}"
AWSCLI="${FOUNDIT_AWSCLI:-aws}"

# shellcheck source=server/common.sh
. "$HERE/../common.sh"
foundit_set_sudo

# NO PING ON FAILURE, EVER. The dead man's switch at the foot of this script is
# the only thing that says "the backups are working", and a script that pinged
# on the way out of an error would say it while failing. `die` exits; it does
# not curl.
foundit_file_exists "$ENV_FILE" \
  || die "no settings file at $ENV_FILE (see server/backup/backup.env.example)"
# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/founditdump.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

DUMP="$WORK/foundit-${STAMP}.dump"
GLOBALS="$WORK/globals-${STAMP}.sql"

# --- 1 and 2 ---------------------------------------------------------------
say "dumping roles and grants"
$SUDO docker exec -i -u postgres "$DB_CONTAINER" pg_dumpall --globals-only > "$GLOBALS"

say "dumping ${DB_NAME}"
# `-T` on exec: without it Docker allocates a TTY and mangles the binary
# stream, which produces a dump that looks fine until the day it is needed.
$SUDO docker exec -i -u postgres "$DB_CONTAINER" \
  pg_dump -d "$DB_NAME" -Fc -Z 6 --no-owner --no-privileges > "$DUMP"

# --- 3. readable, not merely non-empty -------------------------------------
say "checking the archive is structurally readable"
# NO FILE ARGUMENT: pg_restore reads stdin. `/dev/stdin` looks equivalent and
# is not — pg_restore seeks, the container's /dev/stdin is a pipe, and it then
# reports a bad magic string on a dump that is perfectly good.
$SUDO docker exec -i -u postgres "$DB_CONTAINER" pg_restore -l < "$DUMP" > /dev/null \
  || die "pg_restore cannot read the dump it was just handed. Not uploading."

# --- 4. the floor ----------------------------------------------------------
SIZE="$(wc -c < "$DUMP" | tr -d ' ')"
[ "$SIZE" -ge "$MIN_BYTES" ] \
  || die "the dump is only ${SIZE} bytes (floor ${MIN_BYTES}). Refusing to upload or ping success."
say "dump is ${SIZE} bytes and pg_restore can read it"

# --- 5. encrypt, or say plainly that it is not encrypted -------------------
BUNDLE="$WORK/foundit-${STAMP}.tar"
tar -C "$WORK" -cf "$BUNDLE" "$(basename "$GLOBALS")" "$(basename "$DUMP")"

ARTEFACT="$BUNDLE"
if [ -n "${DUMP_AGE_RECIPIENT:-}" ]; then
  command -v age >/dev/null 2>&1 || die "DUMP_AGE_RECIPIENT is set but \`age\` is not installed"
  age -r "$DUMP_AGE_RECIPIENT" < "$BUNDLE" > "${BUNDLE}.age"
  ARTEFACT="${BUNDLE}.age"
  say "encrypted to a recipient whose private half is not on this machine"
else
  # NOT a warning that scrolls past. On the server this is a launch blocker
  # (docs/launch-checklist.md item 24); here it is correct and says why.
  say "NOT ENCRYPTED: DUMP_AGE_RECIPIENT is unset. Correct only where the"
  say "               database holds invented data and the repository is a"
  say "               directory on this same disk. Never correct on the host."
fi

# --- 6. into the repository ------------------------------------------------
NAME="$(basename "$ARTEFACT")"

if [ -n "${BACKUP_REPO_PATH:-}" ]; then
  mkdir -p "$BACKUP_REPO_PATH"
  cp "$ARTEFACT" "$BACKUP_REPO_PATH/$NAME"
  say "wrote ${NAME} to the filesystem repository"
elif [ -n "${BACKUP_S3_BUCKET:-}" ]; then
  [ -n "${BACKUP_S3_ENDPOINT:-}" ] || die "BACKUP_S3_BUCKET is set but BACKUP_S3_ENDPOINT is not"
  command -v "$AWSCLI" >/dev/null 2>&1 || die "$AWSCLI is not installed"
  # The key and the secret reach the CLI through the environment, which
  # `set -a` above already exported. They are never arguments.
  "$AWSCLI" s3 cp "$ARTEFACT" \
    "s3://${BACKUP_S3_BUCKET}/${BACKUP_S3_PREFIX:-logical-dumps}/${NAME}" \
    --endpoint-url "$BACKUP_S3_ENDPOINT" >/dev/null \
    || die "the upload failed"
  say "uploaded ${NAME} to the bucket"
else
  die "neither BACKUP_REPO_PATH nor BACKUP_S3_BUCKET is set in $ENV_FILE"
fi

# --- 7. retention ----------------------------------------------------------
KEEP="${BACKUP_KEEP_DAYS:-14}"
if [ -n "${BACKUP_REPO_PATH:-}" ]; then
  find "$BACKUP_REPO_PATH" -name 'foundit-*.tar*' -mtime "+${KEEP}" -delete 2>/dev/null || true
else
  # An R2 LIFECYCLE RULE is the better answer and research/11 §5.3 says so:
  # a rule at the bucket means the key on this box never needs Delete, and a
  # backup box that cannot delete is a backup box a compromise cannot empty.
  say "retention on the bucket is a lifecycle rule, not this script (research/11 §5.3)"
fi

# --- 8. and only now ------------------------------------------------------
say "OK ${STAMP} size=${SIZE}"
if [ -n "${BACKUP_PING_URL:-}" ]; then
  curl -fsS -m 20 --retry 3 "$BACKUP_PING_URL" > /dev/null || true
fi
