# ===========================================================================
# The four lines every script in server/ needs, and gets wrong separately if
# each one writes them.
#
# Sourced, never executed:  . "$(dirname "$0")/common.sh"
#
# ---------------------------------------------------------------------------
# WHY `sudo` IS DECIDED RATHER THAN ASSUMED
#
# These scripts run in three places and the answer differs in all three:
#
#   on the host, as founditops   founditops is in the `docker` group
#                                (research/07 §2), so `docker` needs no sudo —
#                                but the env files are under /root/.foundit at
#                                mode 0600, so reading one does.
#   on the host, as root         neither needs sudo, and the scripts refuse to
#                                run this way anyway: a deploy has no reason to
#                                be root, and every mistake in one then has no
#                                bound.
#   on this development machine  there is no sudo at all. Windows 11 ships a
#                                `sudo` COMMAND that is switched off by
#                                default, so `command -v sudo` finds one that
#                                exits with an error message — which is how an
#                                earlier version of this logic decided to use
#                                it and then failed on its first docker call.
#
# So it is decided by ASKING, not by looking: sudo is used only where the
# plain command does not work, and only after `sudo -n true` proves sudo
# itself works without a prompt. A script that stops at a password prompt in
# a cron job is a script that has silently stopped running.
# ===========================================================================

say()  { printf '==> %s\n' "$*"; }
warn() { printf '!! %s\n' "$*" >&2; }
die()  { printf '!! %s\n' "$*" >&2; exit "${2:-1}"; }

# Does sudo exist AND work without asking for a password?
foundit_sudo_works() {
  command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1
}

# --- refuse to be root -----------------------------------------------------
foundit_refuse_root() {
  if [ "$(id -u)" = "0" ]; then
    warn "refusing: run this as founditops, not as root."
    warn "It uses sudo for the steps that need it, and nothing else."
    exit 77
  fi
}

# --- SUDO: "" when nothing needs it ----------------------------------------
#
# Set by asking the daemon, because "can this account use Docker" is exactly
# the question and every proxy for it is wrong somewhere.
foundit_set_sudo() {
  SUDO=""
  if [ "$(id -u)" = "0" ]; then return 0; fi
  if docker info >/dev/null 2>&1; then return 0; fi
  if foundit_sudo_works; then SUDO="sudo"; return 0; fi
  die "this account cannot reach the Docker daemon and sudo is not available here"
}

# --- reading a root-only file ----------------------------------------------
#
# `[ -f /root/.foundit/app.env ]` is FALSE for founditops even when the file is
# there, so a plain existence check would make every script refuse to run on
# the host it was written for. Ask through sudo when a plain test cannot see it.
foundit_file_exists() { # foundit_file_exists <path>
  [ -f "$1" ] && return 0
  if [ -n "${SUDO:-}" ]; then $SUDO test -f "$1" && return 0; fi
  return 1
}

# --- is this a tag we will hand to docker? ---------------------------------
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
# `case` AND A MEASURED LENGTH, NOT `grep`, AND THE PHASE 9a REVIEW'S F10 IS
# WHY. Both scripts used `printf '%s' "$TAG" | grep -Eq '^sha-[0-9a-f]{7,40}$'`
# and `grep` matches LINE BY LINE, so a string whose SECOND line is a valid tag
# passed. The review got `$'../../../etc/passwd\nsha-aaaaaa1'` through, watched
# deploy.sh print the attacker-controlled string and reach `docker compose
# pull`, and was stopped by Docker's own reference parser rather than by the
# validator. `case` matches the whole string, newlines and all: a newline is
# not in `[0-9a-f]`, so a multi-line tag fails on the character class as well
# as on the line count checked first for the sake of the message.
#
# ONE COPY, IN common.sh, because deploy.sh and rollback.sh are the two places
# a tag becomes a `docker run` and they had two copies of one regular
# expression. tests/deploy.test.mjs drives both.
foundit_tag_ok() { # foundit_tag_ok <tag>
  local tag="${1:-}"
  # A tag is one line. `printf '%s'` adds no trailing newline, so `wc -l`
  # counts only the ones that are really in the string.
  [ "$(printf '%s' "$tag" | wc -l | tr -d ' ')" = "0" ] || return 1
  # `case` has no counted repetition, so the 7-to-40 range is measured.
  [ "${#tag}" -ge 11 ] && [ "${#tag}" -le 44 ] || return 1
  case "$tag" in
    sha-*[!0-9a-f]*) return 1 ;;
    sha-?*)          return 0 ;;
    *)               return 1 ;;
  esac
}

# --- and its MODE ----------------------------------------------------------
#
# THE PHASE 9a REVIEW'S F11. server/deploy.sh's §1c said the env files were
# "checked for existence and mode" and the loop under it called only
# `foundit_file_exists`. Four full deploy runs in that review used app.env,
# embed.env and migrate.env at mode 0644 and nothing said a word — and
# migrate.env holds DATABASE_URL_OWNER, which the file itself calls "the ONLY
# place the owner's credentials exist on this machine outside the database
# itself". A comment claiming a check is worse than no check, because it stops
# the next person adding one.
#
# `stat -c %a` through `$SUDO`, because founditops cannot stat a root-only
# file either. Echoes the mode and nothing else: a path is safe to print, a
# file's contents are not, and this function never opens one.
#
# Prints the mode, or the empty string when it cannot be read at all.
foundit_file_mode() { # foundit_file_mode <path>
  stat -c '%a' "$1" 2>/dev/null && return 0
  if [ -n "${SUDO:-}" ]; then $SUDO stat -c '%a' "$1" 2>/dev/null && return 0; fi
  printf '%s' ""
}

# Does this filesystem enforce a mode at all?
#
# NOT A GET-OUT, AND IT PROVES ITSELF RATHER THAN GUESSING. Git Bash on the
# development machine maps every file to 0644 whatever `chmod` is told, so a
# 0600 check there would refuse every run of deploy.sh and the whole script
# would become untestable on the only machine that can test it — which is how a
# check gets deleted. So: write one file, chmod it 600, read it back. On the
# host (ext4) that answers 600 and the check is made; where it answers anything
# else the caller says so out loud and goes on.
#
# It cannot be used to weaken the check on the server, because the server's
# filesystem answers 600.
foundit_modes_enforced() {
  local probe seen
  probe="$(mktemp "${TMPDIR:-/tmp}/foundit-mode.XXXXXX" 2>/dev/null)" || return 1
  chmod 600 "$probe" 2>/dev/null || { rm -f "$probe"; return 1; }
  seen="$(stat -c '%a' "$probe" 2>/dev/null || echo "")"
  rm -f "$probe"
  [ "$seen" = "600" ]
}

# --- one deploy at a time --------------------------------------------------
#
# THE PHASE 9a REVIEW'S F3, and it is the worst thing the review found in
# server/. Two `deploy.sh` runs of two GOOD tags, started together:
#
#   D succeeded and recorded itself. C's `up -d --wait` then saw the container
#   D had just recreated, called it a failed deploy of C, and ran its own
#   rollback — putting back a tag from TWO deploys ago that nobody had asked
#   for. The site ended up running sha-aaaaaa1 while `current_tag` said
#   sha-ddddddd: the one file the runbook, rollback.sh and the operator all
#   read was wrong about what is deployed, and a `rollback.sh` afterwards went
#   to `previous_tag`, which was already what was running, and reported
#   success. Two pre-migration dumps were taken one second apart.
#
# Two deploys at once is not exotic: release.yml has `workflow_dispatch`, the
# runbook tells the operator to run deploy.sh twice in step 4, and deploy.sh's
# own header advertises idempotency as the thing that makes re-running safe.
#
# `flock` WHERE THERE IS ONE, `mkdir` WHERE THERE IS NOT, and the difference is
# worth stating rather than hiding. The host is Debian and has util-linux, so
# it takes the flock path: the kernel drops the lock when the process dies,
# however it dies. Git Bash on the development machine has no `flock` at all,
# so the scripts — and tests/deploy.test.mjs, which is what proves any of this
# — use the `mkdir` path, which is atomic on every filesystem either of these
# machines has and is the oldest shell lock there is. Its one weakness is a
# stale directory after a `kill -9`, so the refusal says how to clear one.
#
# Called with the state directory. Exits 75 rather than returning, because
# "somebody else is deploying" is not a condition any caller should handle.
foundit_take_deploy_lock() { # foundit_take_deploy_lock <state-dir>
  FOUNDIT_LOCK_DIR="$1/.deploy.lock"
  FOUNDIT_LOCK_HELD=""

  if command -v flock >/dev/null 2>&1; then
    exec 9>"$1/.deploy.lock.file"
    if ! flock -n 9; then
      warn "a deploy is already running (it holds $1/.deploy.lock.file)."
      warn "Wait for it to finish and read $1/deploy.log before starting another."
      exit 75
    fi
    FOUNDIT_LOCK_HELD="flock"
    return 0
  fi

  if ! mkdir "$FOUNDIT_LOCK_DIR" 2>/dev/null; then
    warn "a deploy is already running (it holds $FOUNDIT_LOCK_DIR)."
    warn "Wait for it to finish and read $1/deploy.log before starting another."
    warn "If a previous run was killed outright, remove that directory by hand."
    exit 75
  fi
  FOUNDIT_LOCK_HELD="mkdir"
  trap 'foundit_release_deploy_lock' EXIT
  return 0
}

foundit_release_deploy_lock() {
  if [ "${FOUNDIT_LOCK_HELD:-}" = "mkdir" ] && [ -n "${FOUNDIT_LOCK_DIR:-}" ]; then
    rmdir "$FOUNDIT_LOCK_DIR" 2>/dev/null || true
  fi
}
