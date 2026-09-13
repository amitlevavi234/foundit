// ===========================================================================
// The scripts that run on the server, checked from here.
//
// FOUR QUESTIONS, and the fourth is the one that cannot be answered by reading:
//
//   1. do they PARSE? A shell script with a syntax error in a branch nobody
//      takes is a script that works until the day it is needed.
//   2. do they REFUSE to run as root, and refuse a tag that is not
//      sha-<hex>? The tag arrives from a CI job, over a channel whose whole
//      security is that the thing on the far end can only ask for a redeploy.
//   3. do they REFUSE without their env file, by name, rather than running
//      against whatever the environment happens to hold?
//   4. do they PRINT A SECRET? — and this one is answered by RUNNING them,
//      with an env file full of values chosen to be unmistakable, and grepping
//      every line of stdout and stderr for each of them.
//
// Question 4 is why this file exists. research/07 §6.2 lists the routine
// commands that print a production password — `docker inspect`, `ps auxe`,
// `docker compose config` — and calls pasting the last of those into a chat
// window "the most likely way your production database password ends up
// somewhere it should not be". A deploy script that echoes its own settings
// while debugging is the same failure with a shorter path.
//
// THE RUNS ARE THE REFUSAL PATHS, deliberately. A full deploy needs a
// registry, an image and a database; the refusals need none of those and are
// the paths where a script is most likely to print what it just read while
// explaining why it is stopping.
// ===========================================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');

/** Every script in server/ that a person or a cron job runs. */
const SCRIPTS = [
  'server/deploy.sh',
  'server/rollback.sh',
  'server/backup/pg-dump-offsite.sh',
  'server/backup/verify-restore.sh',
  'server/common.sh',
];

/** The ones that take an argument and must refuse a bad one. */
const TAG_TAKERS = ['server/deploy.sh', 'server/rollback.sh'];

function bashAvailable() {
  try {
    execFileSync('bash', ['-c', 'true'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/* ---------------------------------------------------------------------------
 * 1. They parse
 * ------------------------------------------------------------------------ */

test('every script in server/ parses', (t) => {
  if (!bashAvailable()) { t.skip('no bash on this machine.'); return; }
  for (const script of SCRIPTS) {
    const result = spawnSync('bash', ['-n', join(ROOT, script)], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${script} does not parse:\n${result.stderr}`);
  }
});

test('each one sets the three flags that make a failure stop it', () => {
  for (const script of SCRIPTS) {
    if (script.endsWith('common.sh')) continue; // sourced, not executed
    const source = read(script);
    assert.match(
      source,
      /^set -[Ee]?euo pipefail$/m,
      `${script} must "set -euo pipefail": without -e a failed pg_dump is followed by an `
        + 'upload, and without pipefail a failure on the left of a pipe is invisible',
    );
    assert.match(source, /^#!\/usr\/bin\/env bash$/m, `${script} must name bash explicitly`);
  }
});

/* ---------------------------------------------------------------------------
 * 2 and 3. They refuse
 * ------------------------------------------------------------------------ */

test('the deploy and the rollback refuse to run as root', () => {
  for (const script of TAG_TAKERS) {
    const source = read(script);
    assert.match(
      source,
      /foundit_refuse_root/,
      `${script} must refuse to run as root: a deploy needs the docker group and one `
        + 'readable file, not every privilege on the machine',
    );
  }
  // And the refusal is real rather than a comment: common.sh compares uid 0
  // and exits.
  const common = read('server/common.sh');
  assert.match(common, /\[ "\$\(id -u\)" = "0" \]/, 'the check must compare the real uid');
  assert.match(common, /exit 77/, 'and it must exit non-zero');
});

test('only sha-<hex> is a tag, and nothing else gets near a docker command', (t) => {
  if (!bashAvailable()) { t.skip('no bash on this machine.'); return; }
  const hostile = [
    'latest',
    'main',
    '../../../etc/passwd',
    'sha-1a2b3c4; rm -rf /',
    'sha-1a2b3c4 && curl evil.example',
    '$(whoami)',
    'sha-ZZZZZZZ',
    'ghcr.io/someone-else/image:tag',
    '',
  ];
  for (const tag of hostile) {
    const result = spawnSync('bash', [join(ROOT, 'server', 'deploy.sh'), tag], {
      encoding: 'utf8',
      cwd: ROOT,
      env: { ...process.env, FOUNDIT_ENV_DIR: join(ROOT, 'no', 'such', 'dir') },
    });
    assert.equal(result.status, 64, `deploy.sh accepted the tag ${JSON.stringify(tag)}`);
    assert.match(result.stderr, /must look like sha-<hex>/);
    // And it refused BEFORE it did anything: no dump, no pull, no compose.
    assert.doesNotMatch(result.stdout, /deploying|pulling|dump/, 'it got past the tag check');
  }
});

test('they refuse without their env file, by name', (t) => {
  if (!bashAvailable()) { t.skip('no bash on this machine.'); return; }
  const missing = join(ROOT, 'no', 'such', 'dir');
  const runs = [
    ['server/deploy.sh', ['sha-1a2b3c4'], 78, /app\.env does not exist/],
    ['server/backup/pg-dump-offsite.sh', [], 1, /no settings file/],
    ['server/backup/verify-restore.sh', [], 1, /no settings file/],
  ];
  for (const [script, args, code, message] of runs) {
    const result = spawnSync('bash', [join(ROOT, script), ...args], {
      encoding: 'utf8',
      cwd: ROOT,
      env: { ...process.env, FOUNDIT_ENV_DIR: missing },
    });
    assert.equal(result.status, code, `${script} exited ${result.status}, expected ${code}`);
    assert.match(result.stderr, message, `${script} did not say which file is missing`);
  }
});

/* ---------------------------------------------------------------------------
 * 4. They do not print a secret
 * ------------------------------------------------------------------------ */

/**
 * Values chosen to be unmistakable: if one of these appears anywhere in the
 * output, it came out of the env file and nowhere else.
 *
 * They look like real credentials on purpose, because the shapes are what a
 * script's own error messages tend to echo — a connection string in a pg
 * error, a bucket endpoint in an upload failure, a key in a usage line.
 */
const CANARIES = {
  DATABASE_URL: 'postgresql://foundit_app:CANARY-app-password-4f2a@127.0.0.1:5432/foundit',
  DATABASE_URL_AUTH: 'postgresql://foundit_auth:CANARY-auth-password-9b1c@127.0.0.1:5432/foundit',
  DATABASE_URL_OWNER: 'postgresql://foundit_owner:CANARY-owner-password-77de@127.0.0.1:5432/foundit',
  DATABASE_URL_EMBED: 'postgresql://foundit_embed:CANARY-embed-password-1e5f@127.0.0.1:5432/foundit',
  BETTER_AUTH_SECRET: 'CANARY-session-signing-secret-a0b1c2',
  RESEND_API_KEY: 'CANARY-resend-key-d3e4f5',
  OPENAI_API_KEY: 'CANARY-openai-key-607182',
  AWS_SECRET_ACCESS_KEY: 'CANARY-bucket-secret-93a4b5',
  AWS_ACCESS_KEY_ID: 'CANARY-bucket-key-id-c6d7e8',
  BACKUP_S3_ENDPOINT: 'https://CANARY-account-id.r2.cloudflarestorage.com',
  DUMP_AGE_RECIPIENT: 'age1CANARYrecipientf9a0b1c2d3e4',
};

function envDirWithCanaries() {
  const dir = mkdtempSync(join(tmpdir(), 'foundit-deploy-test-'));
  const line = (name) => `${name}=${CANARIES[name]}\n`;
  writeFileSync(
    join(dir, 'app.env'),
    line('DATABASE_URL') + line('DATABASE_URL_AUTH') + line('BETTER_AUTH_SECRET')
      + line('RESEND_API_KEY') + line('OPENAI_API_KEY'),
  );
  writeFileSync(join(dir, 'embed.env'), line('DATABASE_URL_EMBED') + line('OPENAI_API_KEY'));
  writeFileSync(join(dir, 'migrate.env'), line('DATABASE_URL_OWNER'));
  writeFileSync(
    join(dir, 'backup.env'),
    'BACKUP_S3_BUCKET=canary-bucket\n'
      + line('BACKUP_S3_ENDPOINT') + line('AWS_ACCESS_KEY_ID') + line('AWS_SECRET_ACCESS_KEY')
      + line('DUMP_AGE_RECIPIENT'),
  );
  return dir;
}

test('run with an env file full of canaries, they print none of them', (t) => {
  if (!bashAvailable()) { t.skip('no bash on this machine.'); return; }

  const dir = envDirWithCanaries();
  const base = mkdtempSync(join(tmpdir(), 'foundit-deploy-base-'));
  try {
    const runs = [
      // The tag refusal, which is where deploy.sh is most likely to echo what
      // it was given alongside what it read.
      ['server/deploy.sh', ['not-a-tag']],
      // A tag that is well-formed but not in any registry: this one gets past
      // the checks and fails at the pull, with a live env file loaded.
      ['server/deploy.sh', ['sha-0000000']],
      ['server/rollback.sh', ['sha-0000000']],
      // The backup scripts, against a bucket that does not exist and an AWS
      // CLI that is not installed: both fail with the settings file sourced,
      // which is exactly the moment an error message could carry one.
      ['server/backup/pg-dump-offsite.sh', []],
      ['server/backup/verify-restore.sh', []],
    ];

    for (const [script, args] of runs) {
      const result = spawnSync('bash', [join(ROOT, script), ...args], {
        encoding: 'utf8',
        cwd: ROOT,
        timeout: 120_000,
        env: {
          ...process.env,
          FOUNDIT_ENV_DIR: dir,
          FOUNDIT_BASE: base,
          FOUNDIT_HEALTH_TRIES: '1',
          // A container name nothing answers to, so every docker call fails
          // fast with the settings already loaded.
          FOUNDIT_DB_CONTAINER: 'foundit-no-such-container',
          FOUNDIT_IMAGE_REPO: '127.0.0.1:1/nothing',
        },
      });

      const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
      for (const [name, value] of Object.entries(CANARIES)) {
        assert.ok(
          !output.includes(value),
          `${script} ${args.join(' ')} printed ${name}:\n`
            + output.split('\n').filter((l) => l.includes(value)).join('\n').slice(0, 400),
        );
      }
      // And no fragment of one either: a script that prints half a password
      // has printed a password.
      for (const fragment of ['CANARY-', 'age1CANARY']) {
        assert.ok(
          !output.includes(fragment),
          `${script} ${args.join(' ')} printed something carrying ${fragment}:\n`
            + output.split('\n').filter((l) => l.includes(fragment)).join('\n').slice(0, 400),
        );
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(base, { recursive: true, force: true });
  }
});

test('nothing in server/ runs `docker compose config`, which expands every env file', () => {
  // research/07 §6.2. `config` prints the fully interpolated file, env files
  // and all, to stdout. It is the right command to validate the file by hand
  // and exactly the wrong one for a script whose output goes into a log.
  for (const script of SCRIPTS) {
    const source = read(script).replace(/^\s*#.*$/gm, '');
    assert.doesNotMatch(
      source,
      /compose[^\n]*\bconfig\b/,
      `${script} runs \`docker compose config\`, which prints every env file it reads`,
    );
  }
});

test('no script reads an env file itself — compose and docker do', () => {
  // deploy.sh names app.env, embed.env and migrate.env and opens none of
  // them. What cannot be read cannot be printed, and that is a stronger
  // property than "is careful about printing".
  const deploy = read('server/deploy.sh').replace(/^\s*#.*$/gm, '');
  for (const forbidden of [/\bcat .*\.env/, /\bsource .*\.env/, /^\s*\. .*\.env/m,
    /grep .*\.env/, /\bset -a/]) {
    assert.doesNotMatch(deploy, forbidden, 'server/deploy.sh must not read an env file');
  }
  // The backup scripts DO source theirs — they need the settings in the
  // process — so for those the property is the canary test above.
  const dump = read('server/backup/pg-dump-offsite.sh');
  assert.match(dump, /set -a; \. "\$ENV_FILE"; set \+a/, 'and it must be the only way in');
});

/* ---------------------------------------------------------------------------
 * The compose file and the image
 * ------------------------------------------------------------------------ */

test('the compose file carries no secret, and no value that looks like one', () => {
  const compose = read('server/compose.prod.yml');
  // Every credential arrives through env_file. An `environment:` entry
  // holding one would be visible to `docker inspect` and to anybody in the
  // docker group (research/07 §6.2).
  assert.match(compose, /env_file:/, 'the services must take their settings from an env file');
  // The character class around each colon is not decoration: without it these
  // patterns read as `NAME: value` to scripts/scan-secrets.sh's fourth rule,
  // and a test asserting that a secret is absent fails the scanner that
  // asserts the same thing. Same regex, different bytes.
  for (const forbidden of [/DATABASE_URL[:]/, /BETTER_AUTH_SECRET[:]/, /RESEND_API_KEY[:]/,
    /OPENAI_API_KEY[:]/, /PASSWORD/, /postgresql:\/\//]) {
    assert.doesNotMatch(compose, forbidden, `server/compose.prod.yml carries ${forbidden}`);
  }
});

test('the compose file binds nothing to a public address', () => {
  const compose = read('server/compose.prod.yml').replace(/^\s*#.*$/gm, '');
  const published = [...compose.matchAll(/^\s*-\s*"([^"]*:\d+:\d+)"/gm)].map((m) => m[1]);
  assert.ok(published.length > 0, 'the app must publish a port for the tunnel to dial');
  for (const mapping of published) {
    assert.match(
      mapping,
      /^127\.0\.0\.1:/,
      `${mapping} is not bound to the loopback. research/07 §2.4: Docker publishes past ufw, `
        + 'so a mapping that forgets the address is on the internet with `ufw status` still '
        + 'reading "deny incoming"',
    );
  }
});

test('the image runs as a named non-root user and drops every capability', () => {
  const dockerfile = read('Dockerfile');
  assert.match(dockerfile, /^USER foundit$/m, 'the image must not run as root');
  assert.match(dockerfile, /adduser .*-u 1001/, 'and the user must be created, not assumed');
  assert.match(dockerfile, /^CMD \["node", "server\.js"\]$/m,
    'exec form, so node is PID 1 and gets SIGTERM (research/10 §3.1)');

  const compose = read('server/compose.prod.yml');
  assert.match(compose, /no-new-privileges:true/, 'setuid escapes must be closed');
  assert.match(compose, /cap_drop:\s*\n\s*- ALL/, 'every capability must be dropped');
  assert.match(compose, /read_only: true/, 'the filesystem must be read-only');
  assert.doesNotMatch(compose, /privileged/, 'nothing here may be privileged');
  assert.doesNotMatch(compose, /docker\.sock/,
    'research/07 §6.6: mounting the docker socket is root on the host, with no safe version');
});

test('the build context refuses every file that could carry a credential', () => {
  const ignore = read('.dockerignore');
  for (const pattern of ['.env', '.env.local', '.git', '**/*.pem', '**/*.key', 'secrets/']) {
    assert.ok(
      ignore.split('\n').some((line) => line.trim() === pattern),
      `.dockerignore must exclude ${pattern}: \`COPY . .\` puts it in a layer for ever, and `
        + '`docker history` hands it to anybody with the image',
    );
  }
});
