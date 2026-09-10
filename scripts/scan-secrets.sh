#!/usr/bin/env bash
# Refuse to let a real credential reach a commit.
#
#   bash scripts/scan-secrets.sh
#
# It scans the files git tracks, plus the untracked files .gitignore does not
# cover — everything that is in a commit or one `git add .` away from being in
# one. That is the whole point: the rule is not "no password on this laptop",
# it is "no password in the repository". .env.local is ignored by git and so
# invisible here, which is correct; what this catches is the day someone
# writes those values into a file that is not ignored.
#
# Two categories of finding:
#
#   1. Shapes that are only ever real. An OpenAI key, an AWS access key, a
#      GitHub token, a private key block. Nobody types one of these by
#      accident and nobody needs one in a tracked file.
#   2. A password inside a connection string, unless it is one of the
#      throwaway literals this project deliberately publishes
#      (db/docker-compose.dev.yml explains why those are fine) or an obvious
#      placeholder from .env.example.
#
# A finding is a failure, not a warning. If something here is a false
# positive, add it to ALLOWED_SECRET_LITERALS below with a comment saying why
# it is safe — deliberately, in a diff someone reviews, rather than by
# loosening a pattern until the scanner stops noticing things.
set -uo pipefail
cd "$(dirname "$0")/.."

# Values that may legitimately appear as a password in a tracked file.
# Anything not on this list is treated as real.
#
#   local_development_only(_app)  the two throwaway passwords in
#                                 db/docker-compose.dev.yml, published on
#                                 purpose; that file says why.
#   REPLACE_*, <...>, your-*      placeholders in .env.example.
#   pass, password, changeme,     placeholders in documentation, e.g. the
#   secret, hunter2               "postgres://user:pass@host" in eval/README.md
#                                 and the "POSTGRES_PASSWORD: hunter2" that
#                                 research/07-server-hardening.md holds up as
#                                 the mistake not to make.
#   %s, ${VAR}, %VAR%             a value the shell or printf substitutes at
#                                 run time, which is the safe pattern.
ALLOWED_SECRET_LITERALS='local_development_only|local_development_only_app|REPLACE_[A-Z_]*|changeme|change-me|pass|password|passwd|examplepass|hunter2|secret|your[-_a-z]*|xxx+|\*\*\*+|\.\.\.|<[^>]*>|\$\{?[A-Za-z_][A-Za-z0-9_]*\}?|%[A-Za-z_]+%|%[sdq]|postgres|foundit'

# Files whose content is not text we can usefully scan.
SKIP_PATH_RE='\.(pdf|png|jpg|jpeg|gif|webp|ico|woff2?|ttf|zip|gz)$'

findings=0

report() { # report <rule> <file:line:text>
  printf '  %-28s %s\n' "$1" "$2"
  findings=$((findings + 1))
}

# --- The files to look at --------------------------------------------------
# Everything git tracks, plus everything git would pick up on the next
# `git add .` — untracked files that .gitignore does not cover. On the runner
# there are no untracked files, so the second list is empty and this is
# exactly "the committed tree". On a laptop it is the more useful question:
# is there a secret in a file that is about to become a commit?
tracked_and_pending() {
  git ls-files
  git ls-files --others --exclude-standard
}
mapfile -t FILES < <(tracked_and_pending | sort -u | grep -Ev "$SKIP_PATH_RE")

if [ "${#FILES[@]}" -eq 0 ]; then
  echo "No tracked files to scan. That is not a pass — is this a git repository?"
  exit 1
fi

echo "Scanning ${#FILES[@]} committed-or-about-to-be-committed files for credentials..."
echo

# --- 1. An environment file that should never be tracked at all ------------
while IFS= read -r f; do
  report "tracked environment file" "$f  (.env files hold real values and must stay untracked)"
done < <(git ls-files | grep -E '(^|/)\.env($|\.local$|\.production$|\.[^/]*\.local$)')

# --- 2. Shapes that are only ever a real credential ------------------------
scan() { # scan <rule> <extended-regex>
  local rule="$1" re="$2"
  while IFS= read -r hit; do
    report "$rule" "$hit"
  # -e matters: several of these patterns begin with a dash, and without it
  # grep reads "-----BEGIN..." as a bundle of options and matches nothing.
  done < <(grep -nHE -e "$re" "${FILES[@]}" 2>/dev/null | cut -c1-200)
}

scan "private key block"     '-----BEGIN [A-Z ]*PRIVATE KEY-----'
scan "anthropic api key"     'sk-ant-[A-Za-z0-9_-]{16,}'
scan "openai api key"        'sk-(proj-)?[A-Za-z0-9]{32,}'
scan "aws access key id"     '(AKIA|ASIA)[0-9A-Z]{16}'
scan "github token"          'gh[pousr]_[A-Za-z0-9]{36,}'
scan "google api key"        'AIza[0-9A-Za-z_-]{35}'
scan "slack token"           'xox[abposr]-[A-Za-z0-9]{8,}-[A-Za-z0-9-]{8,}'
scan "stripe live key"       '[sr]k_live_[A-Za-z0-9]{16,}'
scan "json web token"        'eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}'
# The bracket around one letter keeps this line from matching its own
# pattern. The scanner scans itself, which is the right thing for it to do.
scan "putty private key"     'PuTTY-User-Key-[F]ile'

# --- 3. A password inside a connection string ------------------------------
# A database connection string with a password embedded in it, flagged unless
# that password is one of the throwaway literals allowed above.
while IFS= read -r hit; do
  report "password in a database url" "$hit"
done < <(
  grep -nHE '(postgres|postgresql|mysql|mongodb(\+srv)?|redis|amqp)://[^:/@[:space:]]+:[^@/[:space:]]+@' "${FILES[@]}" 2>/dev/null \
  | grep -Ev "://[^:/@[:space:]]+:($ALLOWED_SECRET_LITERALS)@" \
  | cut -c1-200
)

# --- 4. A named secret assigned a value ------------------------------------
SECRET_NAMES='BETTER_AUTH_SECRET|OPENAI_API_KEY|EMBEDDINGS_API_KEY|ANTHROPIC_API_KEY|GOOGLE_CLIENT_SECRET|POSTGRES_PASSWORD|PGPASSWORD|DB_PASSWORD|API_KEY|SECRET_KEY|PRIVATE_KEY|ACCESS_TOKEN'
while IFS= read -r hit; do
  report "secret assigned a value" "$hit"
done < <(
  grep -nHE "\b($SECRET_NAMES)[[:space:]]*[:=][[:space:]]*[\"']?[^\"'[:space:]#\$]+" "${FILES[@]}" 2>/dev/null \
  | grep -Ev "[:=][[:space:]]*[\"']?($ALLOWED_SECRET_LITERALS)([^A-Za-z0-9_-]|$)" \
  | cut -c1-200
)

echo
if [ "$findings" -gt 0 ]; then
  echo "FAIL: $findings possible credential(s) in files that are, or are about to be, committed."
  echo
  echo "Nothing that looks like a real password, key or token may be committed."
  echo "If one of these is genuinely safe, add its literal value to"
  echo "ALLOWED_SECRET_LITERALS in this script, with a comment saying why."
  exit 1
fi

echo "PASS: no credentials found."
