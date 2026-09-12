// ===========================================================================
// Foundit — how the embedding worker decides WHOSE FAULT a failure was.
//
// This is the one piece of scripts/embed-worker.mjs that is worth testing on
// its own, and it is in its own file for exactly that reason: it is pure
// policy, it owns no connection and no key, and both the provider and the
// spending cap are handed to it. tests/embed-worker.test.mjs drives it with a
// stub that spends nothing.
//
// THE DEFECT IT EXISTS TO CLOSE. The Phase 7 adversarial review pointed a
// deliberately invalid key at a batch of four queued statements and watched
// the worker call `public.embedding_job_failed` on every one of them. Three
// such batches and all four are PARKED — and a parked job only un-parks when
// its text changes again, so a maker whose sentence was queued behind somebody
// else's during a provider outage would have to edit it to get it embedded.
// The worker's own header claimed the opposite: "a batch that fails as a whole
// is recorded against every job in it, so one absurd statement cannot hold the
// other thirty-one behind it forever." It did not hold them behind it. It
// parked them beside it.
//
// SO THERE ARE THREE VERDICTS RATHER THAN ONE.
//
//   embedded  the vector came back. Store it and retire the job.
//   blamed    this input failed ON ITS OWN, in a request of one. It has
//             earned an attempt, and three of those park it.
//   outage    the request failed as a REQUEST. Nobody is charged, nothing is
//             parked, and the jobs are still work for the next tick.
//
// And the way the first is told from the second is a bisection: a whole-batch
// retry, then halves, and only a request carrying ONE document that fails is
// that document's fault. A 400 is the only status worth bisecting for — a 401,
// a 429, a 5xx, a timeout or a socket that would not open is a fact about the
// request, and every half would fail the same way.
// ===========================================================================

/**
 * Is this failure possibly ONE INPUT'S fault?
 *
 * Only a 400. `EmbeddingError` carries the provider's status rather than its
 * body, because an error body from a model provider routinely echoes the input
 * back and a maker's unpublished statement is not log material — so this is a
 * number and not a string match.
 */
export function mayBeOneInput(error) {
  const status = error && typeof error === 'object' ? error.status : null;
  return status === 400;
}

/**
 * Embed these rows, and say for each one what happened.
 *
 * @param rows    `{ job_id, kind, ref_id, body }`, as public.embedding_work
 *                returns them.
 * @param options
 *   `embed(bodies)`  → `{ vectors, model, tokens, truncated }`, which is
 *                      lib/embeddings.ts's `embedTexts` in the worker and a
 *                      stub in the tests.
 *   `mayEmbed(bodies)` → boolean. The spending cap, asked before every
 *                      request, so a bisection cannot spend more than the day
 *                      allows.
 *   `model`          the model name the database expects vectors to be in.
 *   `reasonOf(err)`  a short, non-sensitive reason string.
 *   `truncationReason` what to blame a truncated input for.
 *
 * @returns `{ vectors, tokens, blamed, outage, reason, capped }`
 */
export async function embedBatch(rows, options) {
  return embedSlice(rows, options, 0);
}

async function embedSlice(rows, options, depth) {
  const { embed, mayEmbed, model, reasonOf, truncationReason } = options;
  const empty = { vectors: new Map(), tokens: 0, blamed: [], outage: false };
  if (rows.length === 0) return empty;

  const bodies = rows.map((row) => String(row.body));
  if (!mayEmbed(bodies)) return { ...empty, capped: true };

  let batch;
  try {
    batch = await embed(bodies);
  } catch (error) {
    // ONE RETRY OF THE WHOLE BATCH, and only at the top: the commonest
    // transient failure here is a timeout, and re-sending thirty-two
    // documents is cheaper than bisecting them.
    if (depth === 0 && rows.length > 1) {
      if (!mayEmbed(bodies)) return { ...empty, capped: true };
      try {
        batch = await embed(bodies);
      } catch (retried) {
        if (!mayBeOneInput(retried)) {
          return { ...empty, outage: true, reason: reasonOf(retried) };
        }
        return bisect(rows, options, depth);
      }
    } else if (rows.length === 1) {
      // A request of ONE that fails is that input's fault — unless the
      // provider is simply not answering, which is not.
      if (!mayBeOneInput(error)) {
        return { ...empty, outage: true, reason: reasonOf(error) };
      }
      return { ...empty, blamed: [{ row: rows[0], reason: reasonOf(error) }] };
    } else {
      if (!mayBeOneInput(error)) {
        return { ...empty, outage: true, reason: reasonOf(error) };
      }
      return bisect(rows, options, depth);
    }
  }

  if (batch.model !== model) {
    // Loud, and nothing is stored: the setters would refuse it anyway (0005,
    // 0007), and a table holding vectors from two spaces is a search quietly
    // getting worse. It is the provider's doing and not any row's, so it is an
    // outage rather than a blame — which is a change from the loop this
    // replaced, where every job in the batch was charged an attempt for it.
    return {
      ...empty,
      tokens: batch.tokens,
      outage: true,
      reason: 'provider returned model ' + batch.model + ', not ' + model,
    };
  }

  // Truncated inputs are recorded as failures rather than stored. A vector of
  // a prefix filed under the whole statement is a search that is subtly wrong
  // forever, which is worse than a statement with no vector at all. This one
  // IS per input and always was — it is the branch the review called "the
  // correctly-scoped one".
  const cut = new Set(batch.truncated ?? []);
  const vectors = new Map();
  const blamed = [];
  rows.forEach((row, index) => {
    if (cut.has(index)) {
      blamed.push({ row, reason: truncationReason });
      return;
    }
    vectors.set(row.job_id, batch.vectors[index]);
  });

  return { vectors, tokens: batch.tokens, blamed, outage: false };
}

/** The halves, merged. */
async function bisect(rows, options, depth) {
  const middle = Math.floor(rows.length / 2);
  const left = await embedSlice(rows.slice(0, middle), options, depth + 1);
  const right = await embedSlice(rows.slice(middle), options, depth + 1);

  const vectors = new Map([...left.vectors, ...right.vectors]);
  const blamed = [...left.blamed, ...right.blamed];
  const tokens = left.tokens + right.tokens;

  // EVERY leaf failed alone, so it was never one input: charge nobody. This is
  // the case the review reproduced with an invalid key, where the old loop
  // charged an attempt to all four jobs.
  if (vectors.size === 0 && blamed.length === rows.length) {
    return {
      vectors: new Map(),
      tokens,
      blamed: [],
      outage: true,
      reason: blamed[0]?.reason ?? 'every input in the batch failed alone',
    };
  }
  if (left.outage && right.outage) {
    return { vectors, tokens, blamed, outage: true, reason: left.reason ?? right.reason };
  }
  return {
    vectors,
    tokens,
    blamed,
    outage: false,
    capped: Boolean(left.capped || right.capped),
  };
}
