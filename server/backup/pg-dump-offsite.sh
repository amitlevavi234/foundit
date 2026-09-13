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
#   2. open a snapshot              a REPEATABLE READ transaction that exports
#                                   its snapshot and then holds it open.
#   3. pg_dump -Fc --snapshot=…     the database, compressed, restorable one
#                                   table at a time — AS OF that snapshot.
#   4. counts.txt                   every table's row count, taken inside the
#                                   SAME snapshot. See below.
#   5. pg_restore -l                PROVE IT IS READABLE before trusting it.
#                                   `test -s` passes on a truncated file.
#   6. a size floor                 a dump under the floor means something
#                                   went wrong. Fail loudly; do not upload.
#   7. encrypt                      with the public half of an age key whose
#                                   private half is not on this machine, and
#                                   REFUSE to upload without it.
#   8. put it in the repository     a directory, or an S3-compatible bucket.
#   9. forget the old ones
#  10. record it — success OR failure
#  11. ping the dead man's switch   ONLY here, at the end, on success.
#
# WHY `counts.txt` IS IN THE ARCHIVE — THE PHASE 9a REVIEW'S F5, and it is
# about `verify-restore.sh` rather than about this script. That script's
# assertion was "every table in the SOURCE has the same number of rows in the
# copy", and the source is the live database at verification time while the
# copy is a backup its own staleness check allows to be thirty hours old.
# `search_events` gets a row on every search. One ordinary search between the
# dump and the verification made the weekly check fail — and then fail every
# week from the first search onwards, writing `ok = false` into
# `infra.ops_events` (the red row the dashboard says outranks everything else)
# and never pinging the dead man's switch. A check that is red every week is a
# check nobody reads, which is the same as not having one.
#
# So the counts travel WITH the dump, and they are taken in the dump's own
# snapshot rather than beside it: a search during the dump would otherwise skew
# them by one and bring the same false alarm back in a rarer, harder form.
#
# NO CREDENTIAL IS EVER PRINTED. The settings come from an env file this script
# sources and never echoes; the S3 secret goes to the AWS CLI through the
# environment; and every path printed below is a basename.
#
# AND IT RECORDS ITS OWN FAILURES (F9). `infra.record_ops_event('backup', …)`
# used to be the last line of the script and therefore ran only on success,
# while `app/admin/page.tsx` told the operator that "both write here whether
# they succeed or fail, so a broken backup is a red row rather than an absence
# somebody has to notice". Half of that was false: two failed backups in the
# review left no row, no ping, and a Backups panel showing the last SUCCESSFUL
# backup's date, quietly ageing.
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
# on the way out of an error would say it while failing. `fail` exits; it does
# not curl.
#
# `fail` AND NOT `die`, AND THAT IS F9. Every exit from this script that is not
# a success now goes through one function that writes
# `infra.record_ops_event('backup', false, <one short sentence>)` on the way
# out, mirroring `verify-restore.sh`. The sentence is safe to show a person —
# no path, no endpoint, no credential — because `app/admin/page.tsx` renders it
# and `db/test/admin_test.sql` greps every detail line for a credential shape.
#
# It is defined before anything can fail, and it tolerates its own write
# failing: a database that cannot be reached is exactly when the dump fails,
# and an error handler that throws is an error nobody sees.
# WHICH DATABASE THE ROW GOES IN, and it is deliberately NOT `$DB_NAME`.
# `infra.ops_events` is in the application's database and `public.admin_ops_events`
# reads it from there; the database being DUMPED is an argument, and the
# review's own reproduction of F9 pointed it at a name that does not exist. A
# recorder that followed the argument would have nowhere to write in exactly
# the case it exists for.
RECORD_DB="${FOUNDIT_RECORD_DB:-foundit}"

# THE DETAIL LINE IS ONE SHORT SENTENCE AND NEVER A PATH. 0019's comment on
# that column asks for "one short sentence for a person… never a path with a
# credential in it", `app/admin/page.tsx` renders it, and
# db/test/admin_test.sql greps every detail line for a credential shape and for
# a leading path. So `fail` takes the sentence that is RECORDED and prints any
# longer explanation separately, where it belongs: on the operator's terminal.
record_backup() { # record_backup <true|false> <detail>
  printf "select infra.record_ops_event('backup', %s, \$d\$%s\$d\$);\n" "$1" "$2" \
    | $SUDO docker exec -i -u postgres "$DB_CONTAINER" \
        psql -v ON_ERROR_STOP=1 -qXAt -d "$RECORD_DB" > /dev/null 2>&1 || true
}

fail() { # fail <one short sentence, safe to show a person> [exit code]
  printf '!! %s\n' "$1" >&2
  record_backup false "$1"
  exit "${2:-1}"
}

# AND THE FAILURES NOBODY WROTE A BRANCH FOR. `set -Eeuo pipefail` turns an
# unchecked command's failure into an exit, and an exit with no row is the
# absence F9 is about. The ERR trap catches those; the guard stops a `fail`
# recording twice.
trap 'st=$?; if [ -z "${RECORDING_GUARD:-}" ]; then RECORDING_GUARD=1;
  record_backup false "the dump script stopped unexpectedly at line $LINENO (exit $st)"; fi' ERR

if ! foundit_file_exists "$ENV_FILE"; then
  # The path goes to the operator's terminal and the SENTENCE goes in the row.
  warn "no settings file at $ENV_FILE (see server/backup/backup.env.example)"
  fail "the backup settings file is missing"
fi
# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/founditdump.XXXXXX")"

DUMP="$WORK/foundit-${STAMP}.dump"
GLOBALS="$WORK/globals-${STAMP}.sql"
COUNTS="$WORK/counts-${STAMP}.txt"

# Where the snapshot and the counts are written INSIDE the database container,
# by the server process, and removed again on the way out.
SNAP_IN="/tmp/foundit-snap-${STAMP}.txt"
COUNTS_IN="/tmp/foundit-counts-${STAMP}.txt"
HOLDER=""

# EVERY IN-CONTAINER PATH GOES THROUGH `sh -c`, AND THAT IS NOT STYLE. Git Bash
# on the development machine rewrites any argument that looks like an absolute
# POSIX path into a Windows one before the process sees it, so
# `docker exec … cat /tmp/x` asks for `C:/Users/…/Temp/x` and fails on a file
# that is plainly there. An argument that begins with a command name is left
# alone. On the host it is the same command either way.
in_db() { # in_db <shell line to run inside the database container>
  $SUDO docker exec -u postgres "$DB_CONTAINER" sh -c "$1"
}

cleanup() {
  [ -n "$HOLDER" ] && kill "$HOLDER" 2>/dev/null || true
  in_db "rm -f '$SNAP_IN' '$COUNTS_IN'" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

# --- 1. roles and grants ---------------------------------------------------
say "dumping roles and grants"
$SUDO docker exec -i -u postgres "$DB_CONTAINER" pg_dumpall --globals-only > "$GLOBALS" \
  || fail "pg_dumpall could not read the roles and grants"

# --- 2. one snapshot, held open --------------------------------------------
#
# HOW THE COUNTS COME TO BE IN THE DUMP'S OWN SNAPSHOT, and why it is this
# shape rather than something shorter.
#
# A REPEATABLE READ transaction fixes its snapshot at its first statement and
# `pg_export_snapshot()` hands that snapshot to another session — which is what
# `pg_dump --snapshot` takes. The exporting transaction has to still be open at
# the moment pg_dump adopts it, so it has to outlive the start of the dump, so
# it cannot be a plain `psql -c`.
#
# `COPY … TO <file>` AND NOT psql's STDOUT, because psql buffers a file or a
# pipe and the snapshot id would not arrive until psql exited — which is after
# the transaction it is holding open has ended. A server-side COPY is written
# and closed by the backend as the statement completes, so it is there to be
# read the moment it exists. It is also not transactional, which is why the
# counts survive the holder being killed below.
#
# `pg_sleep` IS WHAT KEEPS IT OPEN, and two minutes is the whole of the window
# pg_dump needs: it adopts the snapshot in its first seconds and nothing after
# that depends on the exporter. Both files are removed in `cleanup`, and the
# transaction is read-only, so the cost of the holder is two minutes of held
# back vacuum on a nightly job.
COUNTS_SQL="$(
  $SUDO docker exec -i -u postgres "$DB_CONTAINER" \
    psql -v ON_ERROR_STOP=1 -qXAt -d "$DB_NAME" < "$HERE/table-counts.sql"
)" || fail "could not read the source's table list"
[ -n "$COUNTS_SQL" ] || fail "the database has no tables in schema public"

say "opening a snapshot for the dump and the counts to share"
printf '%s\n' \
  "begin isolation level repeatable read;" \
  "copy (select pg_export_snapshot()) to '${SNAP_IN}';" \
  "copy (select t || '=' || n from (${COUNTS_SQL}) x order by t) to '${COUNTS_IN}';" \
  "select pg_sleep(120);" \
  "commit;" \
  | $SUDO docker exec -i -u postgres "$DB_CONTAINER" \
      psql -v ON_ERROR_STOP=1 -qXAt -d "$DB_NAME" >/dev/null 2>&1 &
HOLDER=$!

SNAPSHOT=""
for _ in $(seq 1 60); do
  SNAPSHOT="$(in_db "cat '$SNAP_IN' 2>/dev/null" | tr -d '\r\n ' || true)"
  [ -n "$SNAPSHOT" ] && break
  sleep 1
done
[ -n "$SNAPSHOT" ] || fail "the database never exported a snapshot for the dump to use"

# --- 3. the dump, as of that snapshot --------------------------------------
say "dumping ${DB_NAME}"
# `-T` on exec: without it Docker allocates a TTY and mangles the binary
# stream, which produces a dump that looks fine until the day it is needed.
$SUDO docker exec -i -u postgres "$DB_CONTAINER" \
  pg_dump -d "$DB_NAME" -Fc -Z 6 --no-owner --no-privileges --snapshot="$SNAPSHOT" > "$DUMP" \
  || fail "pg_dump could not write the database"

# --- 4. and the counts, out of the same snapshot ---------------------------
in_db "cat '$COUNTS_IN'" > "$COUNTS" 2>/dev/null \
  || fail "the per-table counts were not written"
[ -s "$COUNTS" ] || fail "the per-table counts came back empty"
say "$(grep -c . < "$COUNTS") table counts recorded, in the dump's own snapshot"

# The holder has done its work. It would commit and exit on its own in two
# minutes; there is no reason to make the next step wait for it.
kill "$HOLDER" 2>/dev/null || true
HOLDER=""

# --- 5. readable, not merely non-empty -------------------------------------
say "checking the archive is structurally readable"
# NO FILE ARGUMENT: pg_restore reads stdin. `/dev/stdin` looks equivalent and
# is not — pg_restore seeks, the container's /dev/stdin is a pipe, and it then
# reports a bad magic string on a dump that is perfectly good.
$SUDO docker exec -i -u postgres "$DB_CONTAINER" pg_restore -l < "$DUMP" > /dev/null \
  || fail "pg_restore cannot read the dump it was just handed. Not uploading."

# --- 6. the floor ----------------------------------------------------------
SIZE="$(wc -c < "$DUMP" | tr -d ' ')"
[ "$SIZE" -ge "$MIN_BYTES" ] \
  || fail "the dump is only ${SIZE} bytes (floor ${MIN_BYTES}). Refusing to upload or ping success."
say "dump is ${SIZE} bytes and pg_restore can read it"

# --- 7. encrypt, or refuse to upload ---------------------------------------
BUNDLE="$WORK/foundit-${STAMP}.tar"
tar -C "$WORK" -cf "$BUNDLE" \
  "$(basename "$GLOBALS")" "$(basename "$DUMP")" "$(basename "$COUNTS")"

ARTEFACT="$BUNDLE"
if [ -n "${DUMP_AGE_RECIPIENT:-}" ]; then
  command -v age >/dev/null 2>&1 || fail "DUMP_AGE_RECIPIENT is set but \`age\` is not installed"
  age -r "$DUMP_AGE_RECIPIENT" < "$BUNDLE" > "${BUNDLE}.age" \
    || fail "age could not encrypt the archive"
  ARTEFACT="${BUNDLE}.age"
  say "encrypted to a recipient whose private half is not on this machine"
elif [ -n "${BACKUP_REPO_PATH:-}" ]; then
  # A DIRECTORY ON THIS SAME DISK IS THE ONE CASE WHERE PLAINTEXT IS CORRECT,
  # and it is the development machine's case. It is not an off-site backup at
  # all: nothing leaves the disk, so encrypting it would protect it from
  # somebody who already has it.
  say "NOT ENCRYPTED: DUMP_AGE_RECIPIENT is unset, and the repository is a"
  say "               directory on this same disk. Correct here, where the"
  say "               database holds invented data. Never correct on the host."
else
  # AND IT REFUSES RATHER THAN WARNING — the Phase 9a review's F7. This was a
  # line of output that scrolled past, and nothing in the launch path set the
  # variable: the runbook never generated the key, `age-keygen` appeared
  # nowhere in docs/ or server/, and the checklist item both this script and
  # backup.env.example cited for enforcement (item 24) is about a privacy
  # notice. Following the runbook literally uploaded a plaintext tar holding
  # `pg_dumpall --globals-only` — every role and grant — and the whole
  # database, to R2.
  #
  # So the bucket is not an option without a recipient. 78 is the same code
  # deploy.sh uses for "a required configuration file or value is missing".
  warn "The archive holds every role and grant (pg_dumpall --globals-only) and"
  warn "the whole database. Set DUMP_AGE_RECIPIENT in the settings file to the"
  warn "public half of an age key whose private half is in the owner's password"
  warn "manager and on paper. docs/launch-runbook.md step 1d generates it, and"
  warn "docs/launch-checklist.md item 41 is where it is checked."
  fail "refusing to upload an unencrypted dump to a remote repository" 78
fi

# --- 8. into the repository ------------------------------------------------
NAME="$(basename "$ARTEFACT")"

if [ -n "${BACKUP_REPO_PATH:-}" ]; then
  mkdir -p "$BACKUP_REPO_PATH" || fail "the backup repository directory could not be created"
  cp "$ARTEFACT" "$BACKUP_REPO_PATH/$NAME" || fail "the archive could not be written to the repository"
  say "wrote ${NAME} to the filesystem repository"
elif [ -n "${BACKUP_S3_BUCKET:-}" ]; then
  [ -n "${BACKUP_S3_ENDPOINT:-}" ] || fail "BACKUP_S3_BUCKET is set but BACKUP_S3_ENDPOINT is not"
  command -v "$AWSCLI" >/dev/null 2>&1 || fail "$AWSCLI is not installed"
  # The key and the secret reach the CLI through the environment, which
  # `set -a` above already exported. They are never arguments.
  "$AWSCLI" s3 cp "$ARTEFACT" \
    "s3://${BACKUP_S3_BUCKET}/${BACKUP_S3_PREFIX:-logical-dumps}/${NAME}" \
    --endpoint-url "$BACKUP_S3_ENDPOINT" >/dev/null \
    || fail "the upload failed"
  say "uploaded ${NAME} to the bucket"
else
  warn "neither BACKUP_REPO_PATH nor BACKUP_S3_BUCKET is set in $ENV_FILE"
  fail "no backup repository is configured"
fi

# --- 9. retention ----------------------------------------------------------
KEEP="${BACKUP_KEEP_DAYS:-14}"
if [ -n "${BACKUP_REPO_PATH:-}" ]; then
  find "$BACKUP_REPO_PATH" -name 'foundit-*.tar*' -mtime "+${KEEP}" -delete 2>/dev/null || true
else
  # An R2 LIFECYCLE RULE is the better answer and research/11 §5.3 says so:
  # a rule at the bucket means the key on this box never needs Delete, and a
  # backup box that cannot delete is a backup box a compromise cannot empty.
  say "retention on the bucket is a lifecycle rule, not this script (research/11 §5.3)"
fi

# --- 10. record it ---------------------------------------------------------
#
# `infra.record_ops_event('backup', …)` is what the dashboard's Backups panel
# reads (db/migrations/0019_admin_dashboard.sql). Before Phase 9a nothing
# called it and the panel said "never recorded", honestly; this is the first of
# its two writers, and server/backup/verify-restore.sh is the other.
#
# ON SUCCESS *AND* ON FAILURE (F9). This line used to be the only call, at the
# foot of the script, so a failed nightly dump left the panel showing the last
# successful backup's date, quietly ageing — while app/admin/page.tsx told the
# operator that both writers "write here whether they succeed or fail, so a
# broken backup is a red row rather than an absence somebody has to notice".
# `fail` above is the other half, and every exit from this script goes through
# one of the two.
#
# THE DETAIL LINE IS A SIZE AND A TIMESTAMP. Never the repository, never the
# endpoint, never a path — 0019's comment on that column asks for "one short
# sentence for a person… never a path with a credential in it", and the panel
# renders it to one. db/test/admin_test.sql greps every detail line for a
# credential shape and for a leading path, so this is checked rather than
# promised.
record_backup true "logical dump, ${SIZE} bytes, ${STAMP}"

say "OK ${STAMP} size=${SIZE}"
if [ -n "${BACKUP_PING_URL:-}" ]; then
  curl -fsS -m 20 --retry 3 "$BACKUP_PING_URL" > /dev/null || true
fi
