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
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs';
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
    // The length bound, from both directions.
    `sha-${'a'.repeat(200)}`,
    'sha-1a2b3c',
    'sha-',
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

test('a tag whose SECOND line is valid is still not a tag', (t) => {
  if (!bashAvailable()) { t.skip('no bash on this machine.'); return; }

  // THE PHASE 9a REVIEW'S F10. The check was
  // `printf '%s' "$TAG" | grep -Eq '^sha-[0-9a-f]{7,40}$'`, and `grep` matches
  // LINE BY LINE — so a string whose SECOND line is a valid tag passed. The
  // review ran the third of these end to end: the script printed
  // `==> deploying ../../../etc/passwd`, reached `docker compose pull`, and
  // was stopped by Docker's own reference parser rather than by the validator.
  //
  // THE TAG IS BUILT INSIDE BASH, with `$'…'`, rather than passed as an argv
  // entry. Windows re-parses a process's command line, and a newline in an
  // argument does not survive the trip: the child saw `sha-1a2b3c4` and the
  // test passed for the wrong reason. Building it in the shell that runs the
  // script is what makes this a test of the validator.
  const script = join(ROOT, 'server', 'deploy.sh').replace(/\\/g, '/');
  const missing = join(ROOT, 'no', 'such', 'dir').replace(/\\/g, '/');
  const hostile = [
    "$'evil\\nsha-1a2b3c4'",
    "$'sha-1a2b3c4\\n../../etc/passwd'",
    "$'../../../etc/passwd\\nsha-aaaaaa1'",
    "$'sha-1a2b3c4\\n'",
  ];

  for (const literal of hostile) {
    const result = spawnSync(
      'bash',
      ['-c', `FOUNDIT_ENV_DIR='${missing}' bash '${script}' ${literal}`],
      { encoding: 'utf8', cwd: ROOT, timeout: 120_000 },
    );
    assert.equal(result.status, 64, `deploy.sh accepted the multi-line tag ${literal}`);
    assert.match(result.stderr, /must look like sha-<hex>/);
    assert.doesNotMatch(
      result.stdout,
      /deploying|pulling|dump/,
      `${literal} got past the tag check and reached a docker command`,
    );
  }
  t.diagnostic(`${hostile.length} multi-line tags, all refused with exit 64`);
});

test('the rollback validates its tag the same way, out of one function', () => {
  // The two scripts held two copies of one regular expression, both with F10
  // in them. One copy now, in common.sh, and neither script may grow another.
  const common = read('server/common.sh');
  assert.match(common, /foundit_tag_ok\(\)/, 'common.sh must own the tag check');
  assert.match(common, /sha-\*\[!0-9a-f\]\*\) return 1/, 'and it must be a `case`, not a grep');
  for (const script of TAG_TAKERS) {
    const source = read(script).replace(/^\s*#.*$/gm, '');
    assert.match(source, /foundit_tag_ok/, `${script} must use the shared tag check`);
    assert.doesNotMatch(
      source,
      /grep -Eq? '\^sha-/,
      `${script} still validates its tag with grep, which matches line by line (F10)`,
    );
  }
});

test('two deploys at once: the second one touches nothing and says why', (t) => {
  if (!bashAvailable()) { t.skip('no bash on this machine.'); return; }

  // THE PHASE 9a REVIEW'S F3, and the worst thing it found in server/. Two
  // runs of two GOOD tags, started together: one succeeded and recorded
  // itself, the other's `up -d --wait` saw the container the first had just
  // recreated, called it a failed deploy, and rolled back to a tag from TWO
  // deploys ago that nobody had asked for. The site ended up serving an image
  // `current_tag` did not name, two pre-migration dumps were taken a second
  // apart, and the next `rollback.sh` was a no-op that reported success.
  //
  // The lock is taken BEFORE the dump, the migration and every docker call, so
  // what this asserts is that the loser did nothing at all.
  const dir = envDirWithCanaries();
  const base = mkdtempSync(join(tmpdir(), 'foundit-lock-'));
  try {
    const env = {
      ...process.env,
      FOUNDIT_ENV_DIR: dir,
      FOUNDIT_BASE: base,
      FOUNDIT_HEALTH_TRIES: '1',
      FOUNDIT_DB_CONTAINER: 'foundit-no-such-container',
      FOUNDIT_IMAGE_REPO: '127.0.0.1:1/nothing',
    };

    // The first run is held open by a lock this test takes itself, the same
    // way a slow deploy holds it. Starting two real deploys and hoping they
    // overlap is a test that passes by luck.
    const state = join(base, 'state');
    mkdirSync(state, { recursive: true });
    const held = spawnSync('bash', ['-c',
      `mkdir "${state.replace(/\\/g, '/')}/.deploy.lock" 2>/dev/null && echo TOOK`], {
      encoding: 'utf8',
    });
    assert.match(held.stdout, /TOOK/, 'the test could not take the lock itself');

    const second = spawnSync('bash', [join(ROOT, 'server', 'deploy.sh'), 'sha-0000000'], {
      encoding: 'utf8', cwd: ROOT, timeout: 120_000, env,
    });

    assert.equal(second.status, 75, 'a deploy that cannot have the lock must exit 75');
    assert.match(second.stderr, /a deploy is already running/,
      'and it must say so in words the operator can act on');
    const output = `${second.stdout ?? ''}\n${second.stderr ?? ''}`;
    assert.doesNotMatch(output, /pulling the image|pre-migration dump|applying migrations/,
      'the second run got past the lock and started doing things');
    assert.deepEqual(
      existsSync(join(base, 'backups'))
        ? readdirSync(join(base, 'backups')).filter((f) => f.startsWith('pre-'))
        : [],
      [],
      'the second run took a pre-migration dump — the review saw two, a second apart',
    );
    assert.ok(!existsSync(join(state, 'current_tag')), 'the second run recorded itself');
    assert.ok(!existsSync(join(state, 'deploy.log')), 'the second run wrote to the deploy log');

    // And once the lock is released, a run gets past it — a lock nothing can
    // ever take is an outage.
    rmSync(join(state, '.deploy.lock'), { recursive: true, force: true });
    const third = spawnSync('bash', [join(ROOT, 'server', 'deploy.sh'), 'sha-0000000'], {
      encoding: 'utf8', cwd: ROOT, timeout: 120_000, env,
    });
    assert.notEqual(third.status, 75, 'the lock was not released');
    assert.match(`${third.stdout}`, /deploying sha-0000000/, 'the third run never started');
    t.diagnostic(`second run exit=${second.status}, third run exit=${third.status}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(base, { recursive: true, force: true });
  }
});

test('the env files are checked for their MODE, not only for existing', () => {
  // THE PHASE 9a REVIEW'S F11. §1c said the files were "checked for existence
  // and mode" and the loop called only `foundit_file_exists`; four full deploy
  // runs in that review used app.env, embed.env and migrate.env at 0644
  // without a word, and migrate.env holds the owner's connection string.
  const deploy = read('server/deploy.sh').replace(/^\s*#.*$/gm, '');
  assert.match(deploy, /foundit_file_mode/, 'deploy.sh must read the files’ modes');
  assert.match(deploy, /"\$mode" != "600"/, 'and refuse anything that is not 0600');
  assert.match(deploy, /exit 78/, 'with the env-file exit code');

  const common = read('server/common.sh');
  assert.match(common, /stat -c '%a'/, 'the mode comes from stat');
  assert.match(common, /\$SUDO stat -c '%a'/,
    'and through sudo, because founditops cannot stat a root-only file either');

  // The escape hatch is a PROBE and not a platform guess, and it can only ever
  // open on a filesystem that does not enforce modes at all.
  assert.match(common, /foundit_modes_enforced\(\)/, 'the skip must prove itself');
  assert.match(common, /chmod 600 "\$probe"[\s\S]*?stat -c '%a' "\$probe"/,
    'by writing a file, chmodding it and reading the mode back');
});

test('the rollback leaves a way back, and waits on the app alone', () => {
  const rollback = read('server/rollback.sh').replace(/^\s*#.*$/gm, '');

  // F22, first half: `up -d --wait` with no service named waits on the WORKER
  // too, so a worker in `restarting` at the moment compose polls makes a
  // rollback report failure while a healthy site is serving — the one outcome
  // deploy.sh goes out of its way to avoid.
  assert.match(
    rollback,
    /up -d --wait --wait-timeout 120 --remove-orphans app\b/,
    'rollback.sh must wait on `app` and not on every service',
  );
  assert.match(rollback, /up -d worker/, 'and start the worker without waiting on it');

  // F22, second half: it wrote `current_tag` and not `previous_tag`, so after
  // one rollback both files named the same tag, running it again was a no-op
  // that reported success, and there was no recorded way back to the tag just
  // rolled away from.
  assert.match(rollback, /LEAVING="\$\(cat "\$STATE_DIR\/current_tag"/,
    'rollback.sh must read the tag it is leaving behind');
  assert.match(rollback, /> "\$STATE_DIR\/previous_tag"/,
    'and write it to previous_tag');
  assert.match(rollback, /\[ "\$LEAVING" != "\$TARGET" \]/,
    'unless it is the same tag, where overwriting would lose the real previous');
});

test('housekeeping cannot delete the image the rollback needs', () => {
  // THE PHASE 9a REVIEW'S F23. `docker image prune -af --filter until=336h`
  // removes every image no container references and older than fourteen days,
  // which after a fortnight of one tag running is exactly the image
  // `previous_tag` names — and `pull_policy: missing` then sends rollback.sh
  // to GHCR through the same tunnel that is probably having the bad day.
  const deploy = read('server/deploy.sh').replace(/^\s*#.*$/gm, '');
  assert.doesNotMatch(
    deploy,
    /image prune -af/,
    'deploy.sh prunes every unreferenced image, including the rollback target',
  );
  assert.match(deploy, /image prune -f --filter "until=336h"/,
    'dangling layers only: `-f` without `-a` can never take a tagged image');
  assert.match(deploy, /KEEP_CURRENT=/, 'and the current tag is kept by name');
  assert.match(deploy, /KEEP_PREVIOUS=/, 'and so is the previous one');
  assert.match(deploy, /\[ "\$old" = "\$KEEP_PREVIOUS" \] && continue/,
    'the previous tag must be skipped explicitly');
  assert.match(deploy, /--filter "reference=\$\{REPO\}"/,
    'and nothing outside this repository is this script’s business');
});

test('the worker is checked for long enough to catch a crash loop', () => {
  // THE PHASE 9a REVIEW'S F4. The check was `sleep 3` and
  // `docker inspect -f '{{.State.Running}}'`, and at t+3s a container in
  // `restarting` reports Running=true. The review watched deploy.sh print "the
  // embed worker is running" eleven seconds before the container was dead for
  // good.
  const deploy = read('server/deploy.sh').replace(/^\s*#.*$/gm, '');
  assert.doesNotMatch(deploy, /State\.Running/,
    '`Running` is true for a container in `restarting`; `Status` says which');
  assert.match(deploy, /\{\{\.State\.Status\}\}/, 'the deploy must read .State.Status');
  assert.match(deploy, /\{\{\.RestartCount\}\}/, 'and treat a restart as a crash loop');
  assert.match(deploy, /\$status" = "running"/, 'and require `running` exactly');
  assert.match(deploy, /"\$restarts" = "0"/, 'with no restarts at all');
  assert.match(deploy, /sleep 20/, 'after a settle longer than Docker’s first backoff');
  assert.match(deploy, /exit 76/,
    'and a worker that never comes up is a failed deploy with its own exit code');

  // The app is NOT rolled back for it: the site is healthy, and putting the
  // previous image back would take a good site down for a queue.
  const failure = /THE EMBED WORKER DID NOT COME UP[\s\S]*?exit 76/.exec(deploy);
  assert.ok(failure, 'the worker failure path has gone');
  assert.doesNotMatch(failure[0], /rollback_to_previous/, 'a bad worker must not roll the app back');

  // And the restart policy it is checked against no longer gives up for good.
  const compose = read('server/compose.prod.yml').replace(/^\s*#.*$/gm, '');
  assert.doesNotMatch(compose, /restart: on-failure:3/,
    'on-failure:3 makes three seconds of a transient failure permanent (F4)');
  assert.match(compose, /restart: unless-stopped/, 'the worker must keep trying');
});

test('the host bootstraps as postgres and the owner is an ordinary role', () => {
  // THE PHASE 9a REVIEW'S F8. `server/setup/09-postgres-service.sh` started
  // the container with `POSTGRES_USER: foundit_owner`. The official image
  // creates POSTGRES_USER as the initdb superuser and PostgreSQL will not let
  // SUPERUSER be taken away from the role initdb bootstrapped with — so on the
  // host the owner WAS the superuser, for the life of the data directory, and
  // a superuser bypasses every row-level security policy in the schema. CI
  // knows this and says so at length; this file did not.
  const setup = read('server/setup/09-postgres-service.sh');
  const code = setup.replace(/^\s*#.*$/gm, '');

  assert.match(code, /POSTGRES_USER: postgres/, 'the container must bootstrap as postgres');
  assert.doesNotMatch(code, /POSTGRES_USER: foundit_owner/,
    'bootstrapping as the owner makes the owner a superuser for ever');
  assert.match(code, /nosuperuser nobypassrls/, 'and the owner must be created as an ordinary role');

  // THE THREE COPIES OF ONE ARRANGEMENT, held to the same clauses. They cannot
  // be one file — this one injects passwords that exist only on the host — so
  // this is what stops them drifting.
  const dev = read('db/dev-roles.sql');
  const ci = read('.github/workflows/ci.yml');
  for (const [name, source] of [['server/setup/09-postgres-service.sh', code],
    ['db/dev-roles.sql', dev]]) {
    assert.match(source, /nosuperuser nobypassrls/, `${name}: the owner must not be a superuser`);
    assert.match(source, /createrole/, `${name}: 0001, 0005 and 0013 need CREATEROLE`);
    assert.match(source, /alter schema public owner to foundit_owner/,
      `${name}: a definer function owned by a superuser is an authorisation bypass`);
    // The shell copy escapes the quotes for `printf`; the SQL copy does not.
    assert.match(source, /grant set on parameter \\?"foundit\.definer\\?" to foundit_owner/,
      `${name}: 0020 §2 cannot attach its SET clause without this`);
    for (const role of ['foundit_app', 'foundit_embed', 'foundit_auth']) {
      assert.match(
        source,
        new RegExp(`grant ${role}\\s+to foundit_owner with inherit false, admin option`),
        `${name}: ${role} membership must be SET ROLE only, or a policy scoped to it `
          + 'starts applying to owner sessions',
      );
    }
  }
  assert.match(ci, /POSTGRES_USER: postgres/, 'ci.yml must still bootstrap as postgres');

  // And the runbook has the step that fixes a host built by the old version,
  // with the confirmation that makes it safe.
  const runbook = read('docs/launch-runbook.md');
  assert.match(runbook, /^# Step 1f —/m, 'the runbook needs a step before 2 that re-initialises');
  assert.match(runbook, /n_live_tup/, 'and it must make the operator confirm the host is empty');
  assert.match(runbook, /THIS IS A BLOCKING STEP AND THE REMEDY IS STEP 1f/,
    'step 3a must be blocking, with a written remedy');

  // Item 34 is no longer ticked from laptop evidence.
  const checklist = read('docs/launch-checklist.md');
  const row34 = /^\| 34 \|.*$/m.exec(checklist);
  assert.ok(row34, 'checklist item 34 has gone');
  assert.match(row34[0], /\*\*9b, owner\*\*/, 'item 34 must be evidenced on the host, not here');
});

/* ---------------------------------------------------------------------------
 * The backup pair — the Phase 9a review's F5, F7 and F9
 * ------------------------------------------------------------------------ */

test('the verification compares the copy with the DUMP, never with the live database', () => {
  // THE PHASE 9a REVIEW'S F5, and the most consequential thing it found: a
  // check that would have been red every week from the first search onwards.
  // The assertion was "every table in the SOURCE has the same number of rows
  // in the copy", where the source is the running database at verification
  // time and the copy is a backup up to thirty hours old. `search_events` gets
  // a row on every search. One ordinary search between the dump and the
  // verification failed it — and `ok = false` in infra.ops_events is the red
  // row app/admin/page.tsx says outranks everything on the page, and the dead
  // man's switch is never pinged, so Healthchecks.io alerts too. A check that
  // is red every week is a check nobody reads.
  const verify = read('server/backup/verify-restore.sh').replace(/^\s*#.*$/gm, '');
  const dump = read('server/backup/pg-dump-offsite.sh').replace(/^\s*#.*$/gm, '');

  assert.match(dump, /counts-\$\{STAMP\}\.txt/, 'the dump must write a counts file');
  assert.match(dump, /--snapshot="\$SNAPSHOT"/,
    'and the dump must be taken AS OF the snapshot the counts were taken in');
  assert.match(dump, /pg_export_snapshot\(\)/, 'which means exporting one');
  assert.match(
    dump,
    /tar -C "\$WORK" -cf "\$BUNDLE" [\s\S]{0,120}basename "\$COUNTS"/,
    'and the counts file must be IN the archive, or the verifier cannot reach it',
  );

  assert.match(verify, /COUNTS_FILE=/, 'the verifier must read the archive’s counts file');
  assert.match(verify, /DUMPED_COUNTS=/, 'and compare against those');
  assert.ok(
    !/psql_as "\$DB_NAME"/.test(verify),
    'verify-restore.sh still asks the LIVE database for something — that is F5',
  );

  // And both build the count query from one file, so a difference in the SQL
  // can never read as a difference in the data.
  for (const [name, source] of [['pg-dump-offsite.sh', dump], ['verify-restore.sh', verify]]) {
    assert.match(source, /table-counts\.sql/, `${name} must use the shared counts query`);
  }
});

test('an unencrypted dump is never uploaded anywhere but a local directory', () => {
  // THE PHASE 9a REVIEW'S F7. With DUMP_AGE_RECIPIENT unset the script wrote a
  // PLAINTEXT tar holding `pg_dumpall --globals-only` — every role and every
  // grant — and the whole database, and uploaded it. It said so at the time,
  // in a line that scrolls past, and pointed at "docs/launch-checklist.md item
  // 24" for enforcement. Item 24 is a privacy notice. No item in the forty was
  // about backup encryption, `age-keygen` appeared nowhere in docs/ or
  // server/, and the runbook never generated a key — while step 2d asserted
  // the outcome anyway.
  const dump = read('server/backup/pg-dump-offsite.sh');
  const code = dump.replace(/^\s*#.*$/gm, '');

  assert.match(code, /refusing to upload an unencrypted dump/,
    'the script must refuse rather than warn');
  assert.match(code, /"refusing to upload an unencrypted dump to a remote repository" 78/,
    'and exit 78, the code for a missing required setting');
  // The plaintext path is allowed for a local directory and nowhere else.
  const branch = /if \[ -n "\$\{DUMP_AGE_RECIPIENT:-\}" \]; then[\s\S]*?\nfi/.exec(code);
  assert.ok(branch, 'the encryption branch has gone');
  assert.match(branch[0], /elif \[ -n "\$\{BACKUP_REPO_PATH:-\}" \]/,
    'plaintext must be reachable only when the repository is a directory on this disk');

  // Both cross-references, corrected. Item 24 is the privacy notice.
  for (const file of ['server/backup/pg-dump-offsite.sh', 'server/backup/backup.env.example']) {
    const source = read(file);
    assert.ok(
      !/checklist\.md item 24 is where that is checked/.test(source),
      `${file} still cites item 24, which is about a privacy notice`,
    );
    assert.match(source, /item 41/, `${file} must cite the item that is actually about this`);
  }

  // And the checklist really has that item, and the runbook really makes the key.
  const checklist = read('docs/launch-checklist.md');
  assert.match(checklist, /^\| 41 \|/m, 'docs/launch-checklist.md needs a numbered row 41');
  assert.match(checklist, /encrypted/i, 'and it must be about encryption');
  const runbook = read('docs/launch-runbook.md');
  assert.match(runbook, /age-keygen/, 'the runbook must generate the key pair');
  assert.match(runbook, /DUMP_AGE_RECIPIENT/, 'and say where the public half goes');
});

test('a failed dump leaves a red row, not an absence', () => {
  // THE PHASE 9a REVIEW'S F9. `infra.record_ops_event('backup', …)` was the
  // last line of the script and ran only on success, while app/admin/page.tsx
  // told the operator that both writers "write here whether they succeed or
  // fail, so a broken backup is a red row rather than an absence somebody has
  // to notice". Two failed backups in the review left no row and no ping, and
  // the Backups panel went on showing the last successful date, quietly
  // ageing.
  const dump = read('server/backup/pg-dump-offsite.sh').replace(/^\s*#.*$/gm, '');

  assert.match(dump, /record_backup false/, 'a failure must be recorded');
  assert.match(dump, /trap 'st=\$\?;/, 'including the ones nobody wrote a branch for');
  assert.match(dump, /record_backup true/, 'and a success still is');
  // Every exit that is not the successful one goes through `fail`.
  assert.ok(
    !/\bdie /.test(dump),
    'pg-dump-offsite.sh still uses `die`, which exits without recording anything',
  );

  // The recorded sentence is short and has no path in it: 0019 caps the column
  // at 500 characters and db/test/admin_test.sql greps every detail line.
  for (const [, sentence] of dump.matchAll(/fail "([^"]*)"/g)) {
    assert.ok(sentence.length <= 200, `a recorded sentence is ${sentence.length} characters long`);
    assert.doesNotMatch(sentence, /\$ENV_FILE|\/root\/|\$WORK|\$BACKUP_REPO_PATH/,
      `a recorded sentence carries a path: ${sentence}`);
    assert.doesNotMatch(sentence, /\n/, 'a recorded sentence must be one line');
  }

  // And it is written to the database the dashboard reads, which is not the
  // one the dump was pointed at — the review's own reproduction pointed that
  // at a name that does not exist.
  assert.match(dump, /RECORD_DB="\$\{FOUNDIT_RECORD_DB:-foundit\}"/,
    'the row must go where public.admin_ops_events reads it');
  assert.match(dump, /-d "\$RECORD_DB"/, 'and the recorder must use it');
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
      // A CONTAINER NOTHING ANSWERS TO, so the two backup scripts' `fail` has
      // nowhere to write its `infra.ops_events` row. Since F9 every failure
      // records one, which is the point of F9 — and a test suite that left two
      // rows in the development database's operations log on every run would
      // be putting noise on the dashboard's own panel to prove a refusal that
      // has nothing to do with recording.
      env: { ...process.env, FOUNDIT_ENV_DIR: missing,
        FOUNDIT_DB_CONTAINER: 'foundit-no-such-container' },
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

test('every base image and every action is pinned to something that cannot move', () => {
  // THE PHASE 9a REVIEW'S F19. The Dockerfile argued the case at length —
  // "Pinned by DIGEST as well as by tag, because a tag is a moving target and
  // research/07 §4.6 is right that a server with perfect unattended upgrades
  // and a floating base image is not patched, it is unmeasured" — and then
  // had three bare `FROM node:26-alpine` lines. The workflows were all on
  // mutable major tags, in a job holding `packages: write`.
  const dockerfile = read('Dockerfile');
  const froms = [...dockerfile.matchAll(/^FROM\s+(\S+)/gm)].map((m) => m[1]);
  assert.ok(froms.length >= 3, 'the Dockerfile has lost a stage');
  const digests = new Set();
  for (const image of froms) {
    assert.match(
      image,
      /@sha256:[0-9a-f]{64}$/,
      `${image} is a moving tag: the image built on Monday and the image built on Friday `
        + 'can be different bytes with one name',
    );
    digests.add(image.split('@')[1]);
  }
  assert.equal(digests.size, 1, 'the three stages must be built from ONE base image');
  // The tag stays beside the digest, or nobody can tell which release it is.
  for (const image of froms) assert.match(image, /^node:26-alpine@/, `${image} lost its tag`);

  for (const file of ['.github/workflows/ci.yml', '.github/workflows/release.yml']) {
    const uses = [...read(file).matchAll(/^\s*uses:\s*(\S+)/gm)].map((m) => m[1]);
    assert.ok(uses.length > 0, `${file} uses no actions at all — has it been renamed?`);
    for (const action of uses) {
      assert.match(
        action,
        /@[0-9a-f]{40}$/,
        `${file} uses ${action}, whose owner can move that tag under a job that holds `
          + '`packages: write`',
      );
    }
  }
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
