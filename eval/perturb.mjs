// ===========================================================================
// Four mechanical variants of a sentence, for the perturbation gate.
//
// An adversarial review of the first relevance floor found that golden q052
// sat 0.0015 above an absolute gate, so a full stop, a question mark or the
// word "please" emptied its page. Nobody types a sentence twice the same way,
// and a floor that depends on punctuation is not a floor — so the harness now
// runs every golden query four more times, mechanically disturbed, and counts
// the ones that come back empty under any of them.
//
// The variants are deliberately dull. They are not paraphrases and not typos a
// model would invent: they are the four smallest changes a real person makes
// without noticing, and they must be REPRODUCIBLE, because their vectors are
// recorded in db/seed/embeddings.fixture.json so that CI can run this with no
// API key. One file defines them, and both scripts/embed.mjs and eval/run.mjs
// import it; if they ever disagreed, the fixture would hold vectors for
// sentences the harness never searches with.
// ===========================================================================

/**
 * Swap the two letters nearest the middle of the sentence.
 *
 * "the middle" is found by index rather than by word, so it does not care what
 * alphabet the sentence is in: walk out from the centre until two adjacent
 * non-space characters are found, and swap them. A sentence too short to have
 * an interior pair comes back unchanged, and the caller drops it.
 */
export function transposeMiddle(sentence) {
  const chars = Array.from(String(sentence ?? ''));
  if (chars.length < 4) return chars.join('');
  const middle = Math.floor(chars.length / 2);

  for (let step = 0; step < chars.length; step += 1) {
    for (const i of [middle - step, middle + step]) {
      if (i < 1 || i + 1 > chars.length - 1) continue;
      const a = chars[i];
      const b = chars[i + 1];
      if (a === undefined || b === undefined) continue;
      if (a.trim() === '' || b.trim() === '' || a === b) continue;
      const out = [...chars];
      out[i] = b;
      out[i + 1] = a;
      return out.join('');
    }
  }
  return chars.join('');
}

/**
 * The four variants, in a fixed order, each with the label the report prints.
 * A variant identical to the original is left out: there is nothing to learn
 * from searching the same sentence twice.
 */
export function perturbations(sentence) {
  const original = String(sentence ?? '');
  const out = [
    { label: 'full stop', text: `${original}.` },
    { label: 'question mark', text: `${original}?` },
    { label: 'please', text: `${original} please` },
    { label: 'transposed', text: transposeMiddle(original) },
  ];
  return out.filter((v) => v.text !== original && v.text.trim() !== '');
}

/** Every perturbed sentence for a list of queries, deduplicated. */
export function perturbedTexts(sentences) {
  const seen = new Set();
  for (const sentence of sentences) {
    for (const variant of perturbations(sentence)) seen.add(variant.text);
  }
  return [...seen];
}
