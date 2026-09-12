// ===========================================================================
// The statement generator's gates, attacked one at a time.
//
// docs/build-phases.md Phase 5: **a hallucinated problem statement is worse
// than none.** A statement is a claim, in a tool's own listing, that it solves
// something; the search ranks on it; and once written it looks exactly like the
// 504 a person wrote. So the mechanical gate below refuses a great deal, and
// every refusal here is a sentence a model actually produced.
//
// Nothing in this file needs a key, a database or a network.
// ===========================================================================
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GENERATOR_INSTRUCTIONS,
  GENERATOR_MODEL,
  MAX_STATEMENT,
  MIN_STATEMENT,
  VERIFIER_INSTRUCTIONS,
  VERIFIER_MODEL,
  checkStatement,
  echoesSummary,
  generatorInput,
  namesAnyTool,
  validateGenerated,
  validateVerdict,
  verifierInput,
} from '../lib/generate.ts';

const TOOL = {
  name: 'Sprout Diary',
  summary: 'Logs when you watered each houseplant and reminds you when one is due.',
  existing: ['Half the plants are drowning and the other half are crisp'],
  toolNames: ['Obsidian', 'Splitwise', 'Sprout Diary'],
};

test('a statement in the seed file’s voice passes', () => {
  assert.equal(
    checkStatement('I came back from a fortnight away with no idea which ones had been done', TOOL),
    null,
  );
});

test('the gate refuses each thing it exists to refuse', () => {
  const cases = [
    ['I need an app that reminds me to water things', /product word/],
    ['A tool for watering', /product word/],
    ['Some software to keep track of watering', /product word/],
    ['אני לא זוכר מתי השקיתי', /not written in English/],
    ['короткий текст про полив растений', /not written in English/],
    ['short', /the minimum is 8/],
    [`x${'y'.repeat(MAX_STATEMENT)}`, /the maximum is 200/],
    ['Watering <b>matters</b> and I forget it every single week', /markup or more than one line/],
    ['Watering matters\nand I forget it', /markup or more than one line/],
    ['Obsidian is where I write my watering notes down', /names a tool \(Obsidian\)/],
    ['Sprout Diary tells me when a plant is due a drink', /names a tool \(Sprout Diary\)/],
    ['Logs when you watered each houseplant and reminds you', /summary rephrased/],
    ['Half the plants are drowning and the other half are crisp', /already has, word for word/],
    ['....', /no words in it/],
  ];
  for (const [statement, expected] of cases) {
    const reason = checkStatement(statement, TOOL);
    assert.ok(reason, `"${statement.slice(0, 40)}" was accepted`);
    assert.match(reason, expected);
  }
});

test('the minimum and the maximum are the table’s own', () => {
  // public.tool_problems.statement is `check (length(statement) between 8 and 200)`.
  // Saying it here as well turns a CHECK violation into a sentence a job can
  // print, and the two numbers must not drift.
  assert.equal(MIN_STATEMENT, 8);
  assert.equal(MAX_STATEMENT, 200);
});

test('the echo check catches both ways a model gives up', () => {
  const summary = 'Finds the files on your disk that are copies of each other.';

  // Reordered content words.
  assert.equal(echoesSummary('Copies of each other are the files on my disk', summary), true);
  // A verbatim run, in a sentence that is otherwise its own.
  assert.equal(
    echoesSummary('Every backup leaves the files on your disk that nobody wanted twice', summary),
    true,
  );
  // And an ordinary, different sentence is not caught.
  assert.equal(
    echoesSummary('The drive is full and I am sure most of it is the same holiday twice', summary),
    false,
  );
});

test('a tool name is matched as a whole word, and a short one is not matched at all', () => {
  assert.equal(namesAnyTool('I keep notes in obsidian these days', ['Obsidian']), 'Obsidian');
  assert.equal(namesAnyTool('the obsidianware I use', ['Obsidian']), null);
  assert.equal(namesAnyTool('settle up after a trip', ['Settle Up']), 'Settle Up');
  // Two letters would match half the language; the catalogue has none.
  assert.equal(namesAnyTool('it is on my pc', ['PC']), null);
  assert.equal(namesAnyTool('anything at all', []), null);
});

test('the two validators refuse what the schema might not', () => {
  assert.deepEqual(validateGenerated({ statements: ['a', 'b'] }), { statements: ['a', 'b'] });
  for (const [value, expected] of [
    [null, /not a JSON object/],
    [[], /not a JSON object/],
    [{ statements: 'one' }, /statements is not an array/],
    [{ statements: [1] }, /not a string/],
    [{ statements: [], extra: true }, /extra field "extra"/],
  ]) {
    const checked = validateGenerated(value);
    assert.ok('error' in checked, JSON.stringify(value));
    assert.match(checked.error, expected);
  }

  assert.deepEqual(validateVerdict({ supported: true, reason: 'it says so' }), {
    supported: true,
    reason: 'it says so',
  });
  for (const [value, expected] of [
    [null, /not a JSON object/],
    [{ supported: true }, /the response has the fields supported/],
    [{ supported: 'yes', reason: 'x' }, /supported is not a boolean/],
    [{ supported: true, reason: 5 }, /reason is not a string/],
    [{ supported: true, reason: 'x', why: 'y' }, /the response has the fields/],
  ]) {
    const checked = validateVerdict(value);
    assert.ok('error' in checked, JSON.stringify(value));
    assert.match(checked.error, expected);
  }
});

test('the verifier is shown the tool and one sentence, and nothing else', () => {
  // It must not know that a model wrote the sentence, must not see the
  // generator's instructions, and must not see the other candidates. An
  // "independent second call" that is shown the first call's reasoning is one
  // call with extra steps.
  const input = verifierInput(TOOL, 'the plants are all on different schedules');
  assert.deepEqual(input.split('\n').map((l) => l.split(':')[0]), ['tool', 'summary', 'situation']);
  assert.ok(!input.includes('generated'));
  assert.ok(!VERIFIER_INSTRUCTIONS.includes('model wrote'));
  for (const line of GENERATOR_INSTRUCTIONS.split('\n').filter((l) => l.length > 30)) {
    assert.ok(!VERIFIER_INSTRUCTIONS.includes(line), 'the verifier repeats the generator’s prompt');
  }
});

test('the generator is shown a tool and nothing from the evaluation set', () => {
  const input = generatorInput(TOOL, 2);
  assert.match(input, /^name: Sprout Diary/);
  assert.match(input, /write: 2$/);

  // The rule the phase goal states outright: no golden-set query text is used
  // or seen by the generator. The prompt is a constant in lib/generate.ts and
  // this reads the file the queries live in to make sure none of them is in it.
  const golden = readGolden();
  assert.ok(golden.length >= 60, 'the golden set should be there to check against');
  for (const query of golden) {
    assert.ok(
      !GENERATOR_INSTRUCTIONS.toLowerCase().includes(query.toLowerCase()),
      `the generator prompt quotes a golden query: ${query}`,
    );
    assert.ok(
      !VERIFIER_INSTRUCTIONS.toLowerCase().includes(query.toLowerCase()),
      `the verifier prompt quotes a golden query: ${query}`,
    );
  }

  // And neither prompt so much as opens eval/. Reading the files is this test's
  // business, not the library's.
  const source = readFileSync(new URL('../lib/generate.ts', import.meta.url), 'utf8');
  assert.ok(!/eval\//.test(source.replace(/^\s*\*.*$/gm, '')), 'lib/generate.ts reaches into eval/');
});

test('the two models are two different models', () => {
  // A verifier that is the generator is not a second opinion.
  assert.notEqual(GENERATOR_MODEL, VERIFIER_MODEL);
  assert.equal(GENERATOR_MODEL, 'gpt-5-mini');
  assert.equal(VERIFIER_MODEL, 'gpt-5-nano');
});

import { readFileSync } from 'node:fs';

function readGolden() {
  const text = readFileSync(new URL('../eval/golden.jsonl', import.meta.url), 'utf8');
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const obj = JSON.parse(trimmed);
    if (typeof obj.query === 'string') out.push(obj.query);
  }
  return out;
}
