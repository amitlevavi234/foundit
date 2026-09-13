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
