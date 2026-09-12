#!/usr/bin/env node
// ===========================================================================
// Foundit — the problem-statement generation job.
//
//   node --env-file=.env.local scripts/generate-statements.mjs --dry-run
//   node --env-file=.env.local scripts/generate-statements.mjs [--limit=N]
//
// Writes new problem statements for published tools that have too few, and
// throws away far more than it keeps. Five gates stand between a model's
// sentence and the catalogue; lib/generate.ts's header lists them and says why
// each exists. This file is the one that walks them in order and counts what
// each refused.
//
// Six things about it are deliberate:
//
//   1. IT CONNECTS AS foundit_embed, from DATABASE_URL_EMBED, and refuses any
//      other role by name. The same role the embedding job uses, for the reason
//      db/migrations/0010 gives: writing a statement is not half of an oracle,
//      and the job has to embed what it wrote in order to dedupe it, which is
//      already this role's business. Not foundit_app, and never the owner.
//
//   2. IT TOUCHES NO TABLE. foundit_embed holds no grant on public.tools or
//      public.tool_problems. The queue is public.statement_work(), the names
//      are public.published_tool_names(), the dedupe is
//      public.statement_similarity(), and the write is
//      public.store_generated_statement(). Those four plus
//      public.statements_wanted() are the whole of what it may call here.
//
//   3. EVERY STATEMENT IS CHECKED BY A SECOND, INDEPENDENT MODEL. A different
//      model (gpt-5-nano, against gpt-5-mini's writing), a different prompt,
//      and an input that is only the tool's name, its summary and the one
//      sentence — the verifier is not told a model wrote it, is not shown the
//      generator's instructions, and never sees the other candidates. A
//      `false`, a timeout, or a malformed answer all discard the statement.
//
//   4. NO GOLDEN-SET TEXT IS USED OR SEEN. The generator is shown a tool's own
//      name, summary and existing statements. Nothing in eval/ is opened by
//      this file or by lib/generate.ts, and the prompt is printed by --dry-run
//      so anybody can check that for themselves.
//
//   5. IT IS IDEMPOTENT. The queue only lists tools under the ceiling, and the
//      setter refuses a tool that has reached it, so a second run writes
//      nothing. A statement identical to one the tool already has is refused by
//      the table's own unique constraint.
//
//   6. NOTHING IT PRINTS IS SENSITIVE. Counts, token usage, tool names and the
//      statements themselves — which are about to be public — and never a key
//      or a connection string.
//
// Exit codes: 0 done, 1 configuration, 2 the model provider, 3 the database.
// ===========================================================================
import pg from 'pg';

import { embedTexts } from '../lib/embeddings.ts';
import {
  GENERATOR_INSTRUCTIONS,
  GENERATOR_MODEL,
  VERIFIER_INSTRUCTIONS,
  VERIFIER_MODEL,
  checkStatement,
  generateStatements,
  generatorInput,
  verifierInput,
  verifyStatement,
} from '../lib/generate.ts';
import { readerConfigured } from '../lib/reader-model.ts';

const EXIT = { OK: 0, CONFIG: 1, PROVIDER: 2, DATABASE: 3 };

const ROLE = 'foundit_embed';
const URL_VARIABLE = 'DATABASE_URL_EMBED';

/**
 * How close is too close.
 *
 * A candidate within this cosine of a statement the tool already carries is the
 * same situation said differently, and a second copy of it buys the search
 * nothing while costing a row, a vector and a place in the reranker's prompt.
 * 0.92 is high enough that two genuinely different situations about the same
 * tool ("the disk is full of duplicates" / "every backup left another copy")
 * sit well below it, and low enough to catch a rephrase.
 */
const DUPLICATE_AT = 0.92;

/** Ask for a couple more than are needed, because most gates refuse something. */
const SPARE = 2;

const argv = process.argv.slice(2);
const args = new Set(argv);
let limit = null;
for (const arg of argv) {
  if (arg === '--dry-run') continue;
  const m = /^--limit=(\d+)$/.exec(arg);
  if (m) {
    limit = Number.parseInt(m[1], 10);
    continue;
  }
  process.stderr.write(`unknown argument: ${arg}\n`);
  process.stderr.write(
    'usage: node --env-file=.env.local scripts/generate-statements.mjs [--dry-run] [--limit=N]\n',
  );
  process.exit(EXIT.CONFIG);
}
const dryRun = args.has('--dry-run');

/* --- --dry-run prints the two prompts and calls nothing ------------------- */

if (dryRun) {
  process.stdout.write(`generator model  ${GENERATOR_MODEL}\n`);
  process.stdout.write(`verifier model   ${VERIFIER_MODEL}\n`);
  process.stdout.write(`duplicate at     cosine ${DUPLICATE_AT}\n`);
  process.stdout.write('\n=== the generator prompt ===================================\n');
  process.stdout.write(`${GENERATOR_INSTRUCTIONS}\n`);
  process.stdout.write('\n=== one generator input ====================================\n');
  process.stdout.write(
    `${generatorInput(
      {
        name: 'Sprout Diary',
        summary: 'Logs when you watered each houseplant and reminds you when one is due.',
        existing: ['Half the plants are drowning and the other half are crisp'],
      },
      2,
    )}\n`,
  );
  process.stdout.write('\n=== the verifier prompt ====================================\n');
  process.stdout.write(`${VERIFIER_INSTRUCTIONS}\n`);
  process.stdout.write('\n=== one verifier input =====================================\n');
  process.stdout.write(
    `${verifierInput(
      {
        name: 'Sprout Diary',
        summary: 'Logs when you watered each houseplant and reminds you when one is due.',
      },
      'I came back from a fortnight away with no idea which ones had been done',
    )}\n`,
  );
  process.stdout.write('\n(--dry-run: nothing was called and nothing was written)\n');
  process.exit(EXIT.OK);
}

if (!readerConfigured()) {
  process.stderr.write(
    'No key is set. OPENAI_API_KEY is read first and EMBEDDINGS_API_KEY second;\n'
      + 'both live in .env.local, which is not committed. Run this as\n'
      + '`node --env-file=.env.local scripts/generate-statements.mjs`.\n',
  );
  process.exit(EXIT.CONFIG);
}

const databaseUrl = process.env[URL_VARIABLE];
if (!databaseUrl || databaseUrl.trim() === '') {
  process.stderr.write(
    `${URL_VARIABLE} is not set. It is the ${ROLE} connection string, and this job\n`
      + 'reads it from the environment and nowhere else.\n',
  );
  process.exit(EXIT.CONFIG);
}
try {
  const user = decodeURIComponent(new URL(databaseUrl).username);
  if (user !== ROLE) {
    process.stderr.write(
      `${URL_VARIABLE} connects as "${user}". This job runs as ${ROLE}, which holds a\n`
        + 'handful of function grants and no table privilege of any kind.\n'
        + 'See db/migrations/0010_generated_statements.sql for why.\n',
    );
    process.exit(EXIT.CONFIG);
  }
} catch {
  process.stderr.write(`${URL_VARIABLE} is not a connection string this job can parse.\n`);
  process.exit(EXIT.CONFIG);
}

const WORK_SQL = 'select tool_id, name, summary, statements, wanted from public.statement_work($1::int)';
const NAMES_SQL = 'select public.published_tool_names() as name';
const SIMILARITY_SQL = 'select public.statement_similarity($1::bigint, $2::halfvec) as similarity';
const STORE_SQL =
  'select public.store_generated_statement($1::bigint, $2::text, $3::text, $4::text) as id';

const client = new pg.Client({
  connectionString: databaseUrl,
  application_name: 'foundit-generate',
  statement_timeout: 60_000,
});

let exitCode = EXIT.OK;
try {
  await client.connect();
} catch (error) {
  process.stderr.write(`could not connect to PostgreSQL as ${ROLE}: ${error.code ?? 'error'}\n`);
  process.exit(EXIT.DATABASE);
}

const counts = {
  tools: 0,
  generated: 0,
  refusedShape: 0,
  refusedVerifier: 0,
  /** Within cosine DUPLICATE_AT of a statement the tool already carries. */
  refusedDuplicate: 0,
  /** Word for word one the tool already carries — the table's unique index. */
  refusedIdentical: 0,
  /** The tool reached public.statements_wanted() (SQLSTATE FN001, 0011). */
  refusedCeiling: 0,
  /** Anything else the database said no to, counted per row rather than fatal. */
  refusedStore: 0,
  stored: 0,
  generatorTokensIn: 0,
  generatorTokensOut: 0,
  verifierTokensIn: 0,
  verifierTokensOut: 0,
  embeddingTokens: 0,
  generatorCalls: 0,
  verifierCalls: 0,
};

try {
  const { rows: work } = await client.query(WORK_SQL, [limit]);
  const { rows: nameRows } = await client.query(NAMES_SQL, []);
  const toolNames = nameRows.map((r) => String(r.name));

  process.stdout.write(`role             ${(await client.query('select current_user')).rows[0].current_user}\n`);
  process.stdout.write(`generator        ${GENERATOR_MODEL}\n`);
  process.stdout.write(`verifier         ${VERIFIER_MODEL}\n`);
  process.stdout.write(`tools to do      ${work.length}\n`);
  process.stdout.write(`catalogue        ${toolNames.length} published names for the guards\n\n`);

  for (const tool of work) {
    counts.tools += 1;
    const existing = Array.isArray(tool.statements) ? tool.statements.map(String) : [];
    const wanted = Number(tool.wanted);
    const context = { name: String(tool.name), summary: String(tool.summary ?? ''), existing, toolNames };

    let candidates;
    try {
      const generated = await generateStatements(
        { name: context.name, summary: context.summary, existing },
        wanted + SPARE,
      );
      counts.generatorCalls += 1;
      counts.generatorTokensIn += generated.tokensIn;
      counts.generatorTokensOut += generated.tokensOut;
      candidates = generated.statements.map((s) => String(s).trim()).filter(Boolean);
      counts.generated += candidates.length;
    } catch (error) {
      // One tool that could not be written for is not a reason to abandon the
      // other two hundred. It is reported and the run carries on.
      process.stdout.write(`  ${context.name}: the generator failed (${error.message})\n`);
      continue;
    }

    let storedForTool = 0;
    for (const candidate of candidates) {
      if (storedForTool >= wanted) break;

      // --- gate 1: shape, free, and it refuses most of what gets refused ----
      const shape = checkStatement(candidate, {
        ...context,
        existing: [...existing],
      });
      if (shape) {
        counts.refusedShape += 1;
        process.stdout.write(`  - ${context.name}: shape — ${shape}\n`);
        continue;
      }

      // --- gate 2: a second, independent model ------------------------------
      let verdict;
      try {
        verdict = await verifyStatement({ name: context.name, summary: context.summary }, candidate);
        counts.verifierCalls += 1;
        counts.verifierTokensIn += verdict.tokensIn;
        counts.verifierTokensOut += verdict.tokensOut;
      } catch (error) {
        // A statement nobody could check is a statement nobody checked.
        counts.refusedVerifier += 1;
        process.stdout.write(`  - ${context.name}: verifier unavailable (${error.message})\n`);
        continue;
      }
      if (!verdict.supported) {
        counts.refusedVerifier += 1;
        process.stdout.write(`  - ${context.name}: verifier said no — ${verdict.reason}\n`);
        continue;
      }

      // --- gate 3: dedupe by meaning, inside the database -------------------
      let similarity = 0;
      try {
        const embedded = await embedTexts([candidate]);
        counts.embeddingTokens += embedded.tokens;
        const { rows } = await client.query(SIMILARITY_SQL, [tool.tool_id, embedded.vectors[0]]);
        similarity = Number(rows[0]?.similarity ?? 0);
      } catch (error) {
        // No vector means no dedupe, and an undeduped statement is a row that
        // makes the catalogue worse in a way nobody would notice. Refuse.
        counts.refusedDuplicate += 1;
        process.stdout.write(`  - ${context.name}: could not be deduped (${error.message})\n`);
        continue;
      }
      if (similarity >= DUPLICATE_AT) {
        counts.refusedDuplicate += 1;
        process.stdout.write(
          `  - ${context.name}: duplicate — cosine ${similarity.toFixed(3)} against one it has\n`,
        );
        continue;
      }

      // --- gate 4: the database -------------------------------------------
      //
      // PER ROW, not per run. Before the Phase 5 review this call was inside
      // the outer try/catch, so one over-length candidate — or one missing
      // model name, or one tool that went unpublished while the job was
      // running — abandoned the other 790. A batch job that stops on the first
      // bad row is a batch job somebody has to babysit.
      //
      // And the two refusals are counted apart since `0011`: the CEILING now
      // raises FN001 and a null means one thing, that this tool already carries
      // this exact statement. A run that did nothing because it was finished
      // and a run that did nothing because it kept writing duplicates used to
      // look identical.
      let stored;
      try {
        const { rows } = await client.query(STORE_SQL, [
          tool.tool_id,
          candidate,
          GENERATOR_MODEL,
          VERIFIER_MODEL,
        ]);
        stored = rows[0]?.id ?? null;
      } catch (error) {
        if (error.code === 'FN001') {
          counts.refusedCeiling += 1;
          process.stdout.write(`  - ${context.name}: already at the ceiling\n`);
          break;
        }
        counts.refusedStore += 1;
        process.stdout.write(`  - ${context.name}: the database refused it (${error.code ?? 'error'}: ${error.message})\n`);
        continue;
      }
      if (stored === null) {
        counts.refusedIdentical += 1;
        process.stdout.write(`  - ${context.name}: this tool already carries that statement word for word\n`);
        continue;
      }
      counts.stored += 1;
      storedForTool += 1;
      existing.push(candidate);
      process.stdout.write(`  + ${context.name}: ${candidate}\n`);
    }
  }

  process.stdout.write('\n');
  process.stdout.write(`tools seen              ${counts.tools}\n`);
  process.stdout.write(`generated               ${counts.generated}\n`);
  process.stdout.write(`rejected — shape        ${counts.refusedShape}\n`);
  process.stdout.write(`rejected — verifier     ${counts.refusedVerifier}\n`);
  process.stdout.write(`rejected — duplicate    ${counts.refusedDuplicate} (within cosine ${DUPLICATE_AT})\n`);
  process.stdout.write(`rejected — identical    ${counts.refusedIdentical} (word for word)\n`);
  process.stdout.write(`rejected — at ceiling   ${counts.refusedCeiling}\n`);
  process.stdout.write(`rejected — database     ${counts.refusedStore}\n`);
  process.stdout.write(`stored                  ${counts.stored}\n`);
  process.stdout.write(`generator calls         ${counts.generatorCalls} (${counts.generatorTokensIn} in, ${counts.generatorTokensOut} out)\n`);
  process.stdout.write(`verifier calls          ${counts.verifierCalls} (${counts.verifierTokensIn} in, ${counts.verifierTokensOut} out)\n`);
  process.stdout.write(`embedding tokens        ${counts.embeddingTokens}\n`);

  const { rows: left } = await client.query(WORK_SQL, [null]);
  process.stdout.write(`still under the ceiling ${left.length} tool(s)\n`);
} catch (error) {
  process.stderr.write(`database error: ${error.message}\n`);
  for (const field of ['detail', 'hint', 'where']) {
    if (error[field]) process.stderr.write(`  ${field}: ${error[field]}\n`);
  }
  exitCode = EXIT.DATABASE;
} finally {
  await client.end();
}

process.exitCode = exitCode;
