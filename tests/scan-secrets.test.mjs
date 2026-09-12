// ===========================================================================
// Does scripts/scan-secrets.sh actually catch the things it says it catches?
//
// The Phase 6 review's F2 is why this file exists. The scanner had passed on
// every commit for five phases and was, at that moment, blind to the one
// secret the phase had just added: there was no shape rule for a Resend key,
// `RESEND_API_KEY` was not in SECRET_NAMES, and the generic `API_KEY` entry
// could not reach inside it because the rule was anchored with `\b` and there
// is no word boundary between an underscore and a letter. A scanner nobody has
// ever seen FAIL is a scanner nobody has ever tested.
//
// So this runs THE REAL SCRIPT — not a transcription of its patterns — over a
// fixture of invented credentials, and asserts a finding on every line.
//
// THE FIXTURE LIVES IN A TEMPORARY DIRECTORY AND NEVER IN THE REPOSITORY, for
// the obvious reason: a file of credential-shaped strings inside the tree is
// the exact thing the scanner exists to refuse, and committing one would teach
// everybody to ignore it. Every value below is assembled at run time out of
// pieces, so this source file contains no string that matches any rule either
// — which the scanner itself checks, because it scans its own tests.
// ===========================================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SCANNER = join(ROOT, 'scripts', 'scan-secrets.sh');
const SOURCE = readFileSync(SCANNER, 'utf8');

/** A forward-slashed path, because bash is what runs the script. */
const slashes = (path) => path.replace(/\\/g, '/');

/**
 * Run the real scanner over a throwaway repository containing `files`.
 *
 * `git init` and nothing else: the script looks at what git tracks PLUS what
 * `git add .` would pick up, so an untracked file in a fresh repository is
 * exactly the case it is built to catch — a secret one command away from a
 * commit.
 */
function scannerOver(files) {
  const dir = mkdtempSync(join(tmpdir(), 'foundit-scan-'));
  try {
    mkdirSync(join(dir, 'scripts'), { recursive: true });
    copyFileSync(SCANNER, join(dir, 'scripts', 'scan-secrets.sh'));
    for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
    execFileSync('git', ['init', '-q', dir], { stdio: 'ignore' });

    try {
      const out = execFileSync('bash', [slashes(join(dir, 'scripts', 'scan-secrets.sh'))], {
        encoding: 'utf8',
      });
      return { status: 0, out };
    } catch (error) {
      return { status: error.status ?? -1, out: `${error.stdout ?? ''}${error.stderr ?? ''}` };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
}

/* ===========================================================================
 * Invented values, assembled here rather than written out.
 *
 * None of them is real and none of them has ever been real: the shapes are
 * from the providers' own documentation (a Resend key is `re_` and 32 more
 * characters; a Google OAuth client secret is `GOCSPX-` and about 28; an
 * OpenAI key is `sk-` and at least 32).
 * ======================================================================== */
const RESEND_KEY = `re${'_'}${'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6'}`;
const GOOGLE_SECRET = `GOCSPX${'-'}${'Xk9Lm2Np4Qr6St8Uv0Wx1Yz3Ab5C'}`;
const OPENAI_KEY = `sk${'-'}${'Zq7Wv3Tn8Rk2Jh6Gd4Fs9Ap1Ml5Bc0Xe7Yu2Iq'}`;
const NAMED_ONLY = 'Zq7WVTNRKJHGDFSAPMLBCXEYUIQ0246';
const IN_A_CONNECTION_STRING = 'Hunt3rNotOnTheAllowList';

const LINES = [
  `RESEND_API_KEY=${RESEND_KEY}`,
  `a_bare_resend_token = ${RESEND_KEY}`,
  `GOOGLE_CLIENT_SECRET=${GOOGLE_SECRET}`,
  `a_bare_google_secret = ${GOOGLE_SECRET}`,
  `X_API_KEY=${NAMED_ONLY}`,
  `OPENAI_API_KEY=${OPENAI_KEY}`,
  `DATABASE_URL=postgres://foundit_app:${IN_A_CONNECTION_STRING}@127.0.0.1:5432/foundit`,
];

test('every invented credential in the fixture is found', () => {
  const { status, out } = scannerOver({ 'fake-secrets.txt': `${LINES.join('\n')}\n` });

  assert.equal(status, 1, `the scanner must fail on a fixture of credentials:\n${out}`);
  assert.match(out, /FAIL: \d+ possible credential/);

  // Every line, by its number. A rule that fires on six of seven is a rule
  // that lets the seventh through, and "it failed" would not have said so.
  LINES.forEach((line, index) => {
    assert.ok(
      out.includes(`fake-secrets.txt:${index + 1}:`),
      `line ${index + 1} was not flagged — ${line.split('=')[0]}\n${out}`,
    );
  });
});

test('the two shapes Phase 6 added are caught with no name beside them', () => {
  // This is F2 exactly: a key pasted as a bare value, with nothing recognisable
  // next to it, used to go straight through. Both lines below are values with
  // no secret-looking name at all.
  const { out } = scannerOver({
    'fake-secrets.txt': `token = ${RESEND_KEY}\nclient = ${GOOGLE_SECRET}\n`,
  });
  assert.match(out, /resend api key\s+fake-secrets\.txt:1:/);
  assert.match(out, /google client secret\s+fake-secrets\.txt:2:/);
});

test('a name ENDING in one of the generic suffixes is a named secret', () => {
  // The anchoring defect, which is the reason RESEND_API_KEY went through: `\b`
  // in front of the group meant `API_KEY` could never match inside a longer
  // name, because `_` and `A` are both word characters.
  const { out } = scannerOver({ 'fake-secrets.txt': `X_API_KEY=${NAMED_ONLY}\n` });
  assert.match(out, /secret assigned a value\s+fake-secrets\.txt:1:/);

  // And the fix stays fixed. The backslash is assembled rather than written,
  // because a `\b` in a JavaScript string is a backspace and this repository
  // has been bitten by that before.
  const wordBoundary = `${String.fromCharCode(92)}b($SECRET_NAMES)`;
  assert.ok(
    !SOURCE.includes(wordBoundary),
    'the named-secret rule must not be anchored with a word boundary again',
  );
  assert.match(SOURCE, /SECRET_NAMES='[^']*\|RESEND_API_KEY\|/, 'RESEND_API_KEY is named in full');
});

test('and .env.example, which is nothing but placeholders, still passes', () => {
  // The other half of a useful scanner: it must not cry wolf over the file
  // whose whole job is to show people which names to set.
  const { status, out } = scannerOver({
    '.env.example': readFileSync(join(ROOT, '.env.example'), 'utf8'),
  });
  assert.equal(status, 0, `.env.example must not be flagged:\n${out}`);
  assert.match(out, /PASS: no credentials found/);
});
