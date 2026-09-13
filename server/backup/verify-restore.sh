#!/usr/bin/env bash
# ===========================================================================
# Prove the backups restore. research/08 §5.8.
#
#   server/backup/verify-restore.sh
#
# "A backup you have never restored is a hypothesis" (research/11 §5.3). This
# is the weekly experiment that settles it: take the NEWEST artefact out of the
# repository — not a local file, not the one this machine happened to write
# ten seconds ago — restore it into a scratch database, and then ASK IT
# QUESTIONS that an empty database would fail.
#
# THE FAILURE MODE THIS EXISTS TO CATCH is not "the restore errored". It is a
# restore that succeeds into an empty database and reports a green tick. So
# the assertions are:
#
#   1. every table in the source has the same number of rows in the copy —
#      per table, compared, not a total;
#   2. `select count(*) from tools where status = 'published'` is not zero;
#   3. the `vector` extension is present AND a real `<=>` query returns rows,
#      because a catalogue row in pg_extension is not a working index;
#   4. and the newest artefact is recent enough to be worth restoring.
#
# WHAT IT WRITES. One row, through `infra.record_ops_event`, whose `detail` is
# the count table as text. NEVER a credential, NEVER a hostname, NEVER a path:
# 0019's comment on that column says "never a stack trace and never a path with
# a credential in it", and the dashboard's Backups panel renders it to a person.
#
# THE KIND IS `restore_test`, WITH AN UNDERSCORE. 0019's check constraint names
# exactly three kinds — 'backup', 'restore_test', 'update_check' — so a
# hyphenated spelling is not a different label, it is a failed INSERT.
#
# IT TEARS DOWN AFTER ITSELF, including when it fails, so a scratch database
# cannot accumulate on a 40 GB disk.
# ===========================================================================
set -Eeuo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=server/common.sh
. "$HERE/../common.sh"

ENV_DIR="${FOUNDIT_ENV_DIR:-/root/.foundit}"
ENV_FILE="${FOUNDIT_BACKUP_ENV:-$ENV_DIR/backup.env}"
DB_CONTAINER="${FOUNDIT_DB_CONTAINER:-foundit-dev-db}"
DB_NAME="${FOUNDIT_DB_NAME:-foundit}"
VERIFY_DB="${FOUNDIT_VERIFY_DB:-foundit_verify}"
OWNER="${FOUNDIT_DB_OWNER:-foundit_owner}"
MAX_AGE_HOURS="${RESTORE_MAX_AGE_HOURS:-30}"
MIN_PUBLISHED="${RESTORE_MIN_PUBLISHED:-1}"
AWSCLI="${FOUNDIT_AWSCLI:-aws}"

STAMP="$(date -u +%FT%TZ)"
foundit_set_sudo

foundit_file_exists "$ENV_FILE" \
  || die "no settings file at $ENV_FILE (see server/backup/backup.env.example)"
# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a

WORK="$(mktemp -d "${TMPDIR:-/tmp}/founditverify.XXXXXX")"

psql_as() { # psql_as <database> [args...]
  local db="$1"; shift
  $SUDO docker exec -i -u postgres "$DB_CONTAINER" \
    psql -v ON_ERROR_STOP=1 -qXAt -d "$db" "$@"
}

DROPPED=""
cleanup() {
  # The scratch database goes, whatever happened. It is a full copy of the
  # catalogue and leaving one behind on every failure fills the disk with
  # copies of the thing the disk is for.
  if [ -z "$DROPPED" ]; then
    psql_as postgres -c "drop database if exists ${VERIFY_DB} with (force)" >/dev/null 2>&1 || true
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

# `record` is called on the way out of both paths, so a FAILED verification is
# a red row on the dashboard rather than an absence somebody has to notice.
record() { # record <ok:true|false> <detail>
  local ok="$1" detail="$2"
  printf "select infra.record_ops_event('restore_test', %s, \$detail\$%s\$detail\$);\n" \
    "$ok" "$detail" \
    | $SUDO docker exec -i -u postgres "$DB_CONTAINER" \
        psql -v ON_ERROR_STOP=1 -qXAt -d "$DB_NAME" >/dev/null
}

fail() { # fail <one short sentence, safe to show a person>
  printf '!! [%s] RESTORE TEST FAILED: %s\n' "$STAMP" "$*" >&2
  record false "$*"
  exit 1
}

# --- 1. the newest artefact in the repository ------------------------------
#
# OUT OF THE REPOSITORY, which is the entire point. Restoring the file this
# machine wrote a moment ago tests `pg_restore`; restoring what the repository
# actually holds tests the backup.
ARTEFACT=""
if [ -n "${BACKUP_REPO_PATH:-}" ]; then
  [ -d "$BACKUP_REPO_PATH" ] || fail "the backup repository does not exist"
  NEWEST="$(ls -1t "$BACKUP_REPO_PATH"/foundit-*.tar* 2>/dev/null | head -1 || true)"
  [ -n "$NEWEST" ] || fail "the backup repository is empty"
  cp "$NEWEST" "$WORK/"
  ARTEFACT="$WORK/$(basename "$NEWEST")"
elif [ -n "${BACKUP_S3_BUCKET:-}" ]; then
  PREFIX="${BACKUP_S3_PREFIX:-logical-dumps}"
  KEY="$("$AWSCLI" s3 ls "s3://${BACKUP_S3_BUCKET}/${PREFIX}/" \
          --endpoint-url "$BACKUP_S3_ENDPOINT" | sort | tail -1 | awk '{print $4}')"
  [ -n "$KEY" ] || fail "the backup bucket has nothing under its prefix"
  "$AWSCLI" s3 cp "s3://${BACKUP_S3_BUCKET}/${PREFIX}/${KEY}" "$WORK/$KEY" \
    --endpoint-url "$BACKUP_S3_ENDPOINT" >/dev/null || fail "could not download the newest backup"
  ARTEFACT="$WORK/$KEY"
else
  fail "neither a filesystem repository nor a bucket is configured"
fi
say "newest artefact: $(basename "$ARTEFACT")"

# --- 2. is it recent enough to be worth anything? --------------------------
#
# The name carries the stamp the dump script wrote: foundit-YYYYmmddTHHMMSSZ.
# Read from the NAME rather than from the file's mtime, because a copy has a
# fresh mtime and would make a month-old backup look like last night's.
BASE="$(basename "$ARTEFACT")"
WHEN="${BASE#foundit-}"; WHEN="${WHEN%%.*}"
if printf '%s' "$WHEN" | grep -Eq '^[0-9]{8}T[0-9]{6}Z$'; then
  ISO="${WHEN:0:4}-${WHEN:4:2}-${WHEN:6:2}T${WHEN:9:2}:${WHEN:11:2}:${WHEN:13:2}Z"
  THEN="$(node -e "process.stdout.write(String(Math.floor(Date.parse('$ISO')/1000)))" 2>/dev/null \
          || date -u -d "$ISO" +%s 2>/dev/null || echo 0)"
  NOW="$(date -u +%s)"
  AGE_H=$(( (NOW - THEN) / 3600 ))
  [ "$AGE_H" -le "$MAX_AGE_HOURS" ] \
    || fail "the newest backup is ${AGE_H}h old, over the ${MAX_AGE_HOURS}h limit"
  say "it is ${AGE_H}h old, inside the ${MAX_AGE_HOURS}h limit"
else
  fail "the newest artefact is not named the way pg-dump-offsite.sh names one"
fi

# --- 3. unpack ------------------------------------------------------------
if [ "${ARTEFACT##*.}" = "age" ]; then
  # ON THE HOST THIS CANNOT WORK, AND THAT IS THE DESIGN. The private half of
  # the key is in the owner's password manager, not on this machine, so the
  # weekly verification on the server runs against the pgBackRest repository
  # (which is encrypted with a passphrase the server DOES have) and the
  # encrypted logical dump is verified by hand at the quarterly drill.
  # docs/launch-runbook.md step 2 carries that distinction.
  [ -n "${DUMP_AGE_IDENTITY:-}" ] || fail "the newest artefact is encrypted and no identity is configured"
  age -d -i "$DUMP_AGE_IDENTITY" < "$ARTEFACT" > "${ARTEFACT%.age}" || fail "could not decrypt"
  ARTEFACT="${ARTEFACT%.age}"
fi
tar -C "$WORK" -xf "$ARTEFACT" || fail "the artefact is not a readable archive"
DUMP="$(ls -1 "$WORK"/foundit-*.dump 2>/dev/null | head -1 || true)"
[ -n "$DUMP" ] || fail "the archive holds no pg_dump file"

# --- 4. restore into a scratch database ------------------------------------
say "restoring into ${VERIFY_DB}"
psql_as postgres -c "drop database if exists ${VERIFY_DB} with (force)" >/dev/null
psql_as postgres -c "create database ${VERIFY_DB} owner ${OWNER}" >/dev/null
# `--no-owner --no-privileges` matches how the dump was taken, and warnings are
# expected: the dump has no owner or grant statements to apply. The counts
# below are the test, not the exit code.
$SUDO docker exec -i -u postgres "$DB_CONTAINER" \
  pg_restore -d "$VERIFY_DB" --no-owner --no-privileges < "$DUMP" \
  >/dev/null 2>"$WORK/restore.log" || say "pg_restore reported warnings; the counts are the test"

# --- 5. THE ASSERTIONS -----------------------------------------------------
#
# PER TABLE, AGAINST THE SOURCE. A total would hide a table that restored
# empty while another grew. The list of tables comes from the SOURCE's
# catalogue, so a table added by a migration tomorrow is compared tomorrow
# without anybody editing this script.
#
# TWO ROUND TRIPS, AND THE FIRST ONE WRITES THE SECOND. `count(*)` cannot be
# taken over a table named by a variable in plain SQL, and `reltuples` is an
# ESTIMATE — it is what the last ANALYZE saw, which on a freshly restored
# database is often -1. So the source's catalogue is asked for a UNION of real
# counts, and that one statement is then run against both databases. A table
# added by a migration tomorrow is compared tomorrow, with nobody editing this.
BUILD="
  select string_agg(
           format('select %L::text as t, count(*)::bigint as n from public.%I',
                  c.relname, c.relname),
           ' union all ' order by c.relname)
    from pg_class c
    join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relkind = 'r'"

COUNTS_SQL="$(psql_as "$DB_NAME" -c "$BUILD")" || fail "could not read the source's table list"
[ -n "$COUNTS_SQL" ] || fail "the source has no tables in schema public"
COUNTS_SQL="select t || '=' || n from ($COUNTS_SQL) x order by t"

SOURCE_COUNTS="$(psql_as "$DB_NAME" -c "$COUNTS_SQL")" || fail "could not count the source"
COPY_COUNTS="$(psql_as "$VERIFY_DB" -c "$COUNTS_SQL")" \
  || fail "the restored copy is missing a table the source has"

if [ "$SOURCE_COUNTS" != "$COPY_COUNTS" ]; then
  # Name the tables that differ, and nothing else. A diff of two count lists
  # is safe to show a person; the rows are not.
  DIFF="$(printf '%s\n' "$SOURCE_COUNTS" "$COPY_COUNTS" | sort | uniq -u \
          | cut -d= -f1 | sort -u | tr '\n' ' ')"
  fail "row counts differ between the source and the restored copy: ${DIFF}"
fi
TABLES="$(printf '%s\n' "$SOURCE_COUNTS" | grep -c . || true)"
say "${TABLES} tables, every one with the same row count as the source"

PUBLISHED="$(psql_as "$VERIFY_DB" -c "select count(*) from public.tools where status = 'published'")"
[ "${PUBLISHED:-0}" -ge "$MIN_PUBLISHED" ] \
  || fail "the restored copy has ${PUBLISHED} published tools, under the floor of ${MIN_PUBLISHED}"

VECTOR="$(psql_as "$VERIFY_DB" -c "select coalesce(extversion,'') from pg_extension where extname='vector'")"
[ -n "$VECTOR" ] || fail "the restored copy has no vector extension"

# A catalogue row is not a working index. Ask it a real distance question.
HITS="$(psql_as "$VERIFY_DB" -c "
  select count(*) from (
    select id from public.tool_problems
     where embedding is not null
     order by embedding <=> (select embedding from public.tool_problems
                              where embedding is not null limit 1)
     limit 5
  ) t" 2>/dev/null || echo 0)"
[ "${HITS:-0}" -ge 1 ] || fail "a vector similarity query returned nothing on the restored copy"

FTS="$(psql_as "$VERIFY_DB" -c "
  select count(*) from public.tool_problems
   where to_tsvector('english', coalesce(statement,'')) @@ plainto_tsquery('english','data')" \
  2>/dev/null || echo "")"
[ -n "$FTS" ] || fail "a full-text query failed on the restored copy"

# --- 6. record it ----------------------------------------------------------
#
# `detail` is the count table as text and nothing else — no path, no
# repository, no endpoint, no host. 0019 caps it at 500 characters, so the
# figures that matter go first and the per-table list is trimmed to fit.
DETAIL="$(printf '%s tables, all counts equal; published=%s; vector=%s; knn=%s; fts=%s; from %s' \
  "$TABLES" "$PUBLISHED" "$VECTOR" "$HITS" "$FTS" "$WHEN")"
TOP="$(printf '%s\n' "$SOURCE_COUNTS" \
  | grep -E '^(tools|tool_problems|reviews|profiles|collections)=' | tr '\n' ' ')"
DETAIL="$(printf '%s | %s' "$DETAIL" "$TOP" | cut -c1-480)"

record true "$DETAIL"
say "[$STAMP] RESTORE TEST PASSED  $DETAIL"

if [ -n "${RESTORE_TEST_PING_URL:-}" ]; then
  curl -fsS -m 20 --retry 3 "$RESTORE_TEST_PING_URL" > /dev/null || true
fi
