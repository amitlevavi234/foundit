/**
 * Rules first, model second, merged — and the model never gets the last word.
 *
 * `lib/constraints.ts` reads a sentence with regular expressions and word
 * lists. It costs nothing, it is deterministic, it is covered by a hundred
 * tests, and it is wrong in one direction only: it misses things. Phase 4 adds
 * `lib/reader-model.ts`, which asks gpt-5-nano to read the same sentence, and a
 * model is wrong in both directions.
 *
 * So this file is the part that makes the second one safe to use.
 *
 *   1. **The rules run first and are never overruled.** A dimension the rules
 *      read is a dimension the model cannot touch. It may only fill one the
 *      rules left empty. (`mode: 'model-wins'` exists solely so the eval can
 *      measure the alternative and report the number; it is not what ships.)
 *
 *   2. **Every field the model returns passes a mechanical guard** before it is
 *      looked at, on top of the schema validation in reader-model.ts. The
 *      guards below are not stylistic — each one is a failure observed while
 *      this was being built, with gpt-5-nano at minimal reasoning effort:
 *
 *        ten platforms at once, and seven flags at once, for "record my screen
 *        and stream it live" — a model that is guessing lists everything;
 *
 *        `["paid"]` for "we all paid for different bits of the holiday", which
 *        would have deleted every free tool from a question about splitting a
 *        bill;
 *
 *        `["he"]` for a Hebrew sentence that says nothing about interface
 *        language — the commonest and worst of them, because it filters a
 *        catalogue that is mostly English down to almost nothing;
 *
 *        an `english` field that was the English sentence copied back.
 *
 *      A guard that fires throws the whole field away and records why. The
 *      search then has exactly what the rules read, which is Phase 3.
 *
 *   3. **The model cannot put words into the text the ranker sees.** `residual`
 *      is accepted only if it is a *deletion* of the sentence — every character
 *      of it appears in the input, in order. That is checked here, arithmetic,
 *      not trusted. A model that rewrote, translated or embellished the
 *      sentence fails it and the rules' residual stands.
 *
 * Nothing in this file opens a socket or touches a database. It is pure, so
 * `tests/reading.test.mjs` can put a handcrafted bad reading through it without
 * a key, a server or a stub.
 */

import {
  FREE_PRICING,
  flagLabel,
  languageName,
  platformLabel,
  readQuery,
  toSearchConstraints,
  type QueryReading as RulesReading,
  type ReadConstraint,
} from './constraints.ts';
import type { QueryReading as ModelReading } from './reader-model';
import type { Platform, PricingModel, SearchConstraints, ToolFlag } from './types';

/* ===========================================================================
 * The guards
 * ======================================================================== */

/**
 * How many values a sentence may plausibly state for one dimension.
 *
 * A person naming three platforms is comparing them, not requiring them
 * ("compare macos and windows file managers" — lib/constraints.ts learned this
 * the same way). A person stating three separate flags in one sentence is rare
 * enough that refusing it costs almost nothing and catches the failure mode
 * that matters: a model listing the whole enum because it has nothing to say.
 */
export const MAX_MODEL_PLATFORMS = 2;
export const MAX_MODEL_FLAGS = 2;
export const MAX_MODEL_LANGUAGES = 1;

/**
 * The only two flags the model may contribute, whatever it answers.
 *
 * Measured, and the measurement was brutal. With all seven allowed, four golden
 * queries lost their entire page:
 *
 *   q055 "have long articles read out loud to me while I am walking"
 *        -> has_free_tier + works_offline      0.9385 -> 0.0000
 *   q003 "budgeting app where my bank details never leave my own computer"
 *        -> e2e_encrypted + no_ads             0.8090 -> 0.0000
 *   q010 "notes app where my notes stay as files on my own computer"
 *        -> accessible + no_ads                0.6338 -> 0.0000
 *   q044 "stop adverts and trackers following me around the internet"
 *        -> e2e_encrypted + no_ads             0.6169 -> 0.0000
 *
 * Not one of those sentences states the flag it was given. The pattern is that
 * the five excluded flags are things a person WANTS rather than things a
 * sentence SAYS — every tool is better for being accessible, ad-free and
 * encrypted, and a model asked what a sentence requires will offer them.
 * `works_offline` and `no_account_needed` are different: they are stated, in
 * words, in a hundred phrasings the word lists in lib/constraints.ts were never
 * going to enumerate ("no server involved at all", "when the wifi is down"),
 * and they are the two the rules most often miss.
 *
 * The other five are not unreachable — the rules read `no_ads` and
 * `e2e_encrypted` from the phrasings that really do state them. They are
 * unreachable *from the model*.
 */
export const MODEL_FLAGS: readonly ToolFlag[] = ['works_offline', 'no_account_needed'];

/**
 * A sentence that names software is asking for software, whatever the model
 * says.
 *
 * This guard exists because of one measurement, and the measurement is the most
 * useful thing Phase 4 found.
 *
 *   "budgeting app where my bank details never leave my own computer"
 *      asks_for_software: FALSE
 *
 *   the same sentence with a full stop            true
 *   the same sentence with a question mark        true
 *   the same sentence with " please" on the end   true
 *   the same sentence with "detials" mistyped     true
 *
 * Four mechanical variants of a sentence containing the word "app" say true and
 * the sentence itself says false. That is not a reading; it is sampling noise
 * in a model that has no temperature control (gpt-5-nano refuses the parameter)
 * and is being asked for a judgement at minimal reasoning effort. And the cost
 * of that particular noise is the highest there is: a person with a real
 * question told the catalogue has nothing, on a page that never ran a search.
 *
 * So the refusal is corroborated. If the sentence names a program — in any of
 * the languages this catalogue serves — the page searches, and the model's
 * "false" is thrown away and counted. Nobody asks for a free plumber, a
 * self-hosted haircut, or an offline babysitter; nobody says "app" when they
 * want a person.
 *
 * It does not save every case and is not meant to: it is one cheap, entirely
 * deterministic check standing between an unstable boolean and an empty page.
 * `eval/perturb.mjs` is what found the instability and is what will find the
 * next one.
 */
const SOFTWARE_WORDS =
  /(?<![\p{L}\p{N}])(?:apps?|applications?|aplicaci[oó]n|aplicativos?|software|programme?s?|programa|программ\p{L}*|приложени\p{L}*|tools?|herramientas?|ferramentas?|outils?|logiciels?|websites?|web\s?app|sites?|extensions?|add-?ons?|plug-?ins?|clients?|browsers?|navegador|navigateur|אפליקצי\p{L}*|תוכנ\p{L}*|כלי\p{L}*|تطبيق\p{L}*|برنامج|برامج|أداة|أدوات)(?![\p{L}\p{N}])/iu;

/** True when the sentence names a program, so a refusal cannot be trusted. */
export function namesSoftware(sentence: string): boolean {
  return SOFTWARE_WORDS.test(String(sentence ?? ''));
}

/** The only two pricing readings a sentence can honestly produce. */
const FREE_SET = new Set<PricingModel>(FREE_PRICING);
const OPEN_SOURCE_SET = new Set<PricingModel>(['open_source']);

function sameSet<T>(values: readonly T[], set: ReadonlySet<T>): boolean {
  return values.length === set.size && values.every((v) => set.has(v));
}

/**
 * Is `candidate` what is left of `source` after deleting characters from it?
 *
 * Case-folded and with whitespace runs collapsed, because "delete the phrase"
 * leaves a double space behind and nobody means that to be a rewrite. Beyond
 * that it is a plain subsequence test: every character of the candidate must
 * appear in the source, in order. A model that reordered, translated, expanded
 * or corrected the sentence cannot pass it, and one that deleted a phrase
 * always does.
 */
export function isDeletionOf(candidate: string, source: string): boolean {
  const fold = (s: string) => s.toLowerCase().replace(/\s+/gu, ' ').trim();
  const a = Array.from(fold(candidate));
  const b = Array.from(fold(source));
  if (a.length > b.length) return false;

  let i = 0;
  for (const ch of b) {
    if (i < a.length && a[i] === ch) i += 1;
  }
  return i === a.length;
}

/** A letter or a digit anywhere: the difference between text and punctuation. */
const HAS_WORD = /[\p{L}\p{N}]/u;

/** One dimension the guards threw away, and the reason, for the eval's report. */
export interface Refusal {
  field: string;
  reason: string;
}

/** A model reading with every field either trustworthy or absent. */
export interface GuardedReading {
  pricing: PricingModel[];
  platforms: Platform[];
  languages: string[];
  flags: ToolFlag[];
  /** '' when the model did not restate, or when the restatement was refused. */
  english: string;
  asksForSoftware: boolean;
  /** '' when the model's residual was refused; the caller falls back. */
  residual: string;
  refused: Refusal[];
}

/**
 * Put one model reading through the guards.
 *
 * @param reading  a reading that has already passed `validateReading`
 * @param input    the sentence the model was given
 */
export function guardReading(reading: ModelReading, input: string): GuardedReading {
  const refused: Refusal[] = [];
  const out: GuardedReading = {
    pricing: [],
    platforms: [],
    languages: [],
    flags: [],
    english: '',
    asksForSoftware: reading.asksForSoftware,
    residual: '',
    refused,
  };

  // --- pricing: one of exactly two readings, or nothing ---------------------
  if (reading.pricing.length > 0) {
    if (sameSet(reading.pricing, FREE_SET)) {
      out.pricing = [...FREE_PRICING];
    } else if (sameSet(reading.pricing, OPEN_SOURCE_SET)) {
      out.pricing = ['open_source'];
    } else {
      // Anything else is a set nobody asked for. ["paid"] and ["free_trial"] in
      // particular are the two that delete the right answer rather than
      // widening the search, and both have been observed.
      refused.push({
        field: 'pricing',
        reason: `${reading.pricing.join('+')} is not a pricing requirement a sentence can state`,
      });
    }
  }

  // --- platforms, flags, languages: arity ----------------------------------
  if (reading.platforms.length > MAX_MODEL_PLATFORMS) {
    refused.push({
      field: 'platforms',
      reason: `${reading.platforms.length} platforms at once is a guess, not a requirement`,
    });
  } else {
    out.platforms = [...reading.platforms];
  }

  if (reading.flags.length > MAX_MODEL_FLAGS) {
    refused.push({
      field: 'flags',
      reason: `${reading.flags.length} flags at once is a guess, not a requirement`,
    });
  } else {
    out.flags = reading.flags.filter((f) => MODEL_FLAGS.includes(f));
    for (const flag of reading.flags) {
      if (!MODEL_FLAGS.includes(flag)) {
        refused.push({
          field: 'flags',
          reason: `${flag} is a thing people want, not a thing a sentence states`,
        });
      }
    }
  }

  if (reading.languages.length > MAX_MODEL_LANGUAGES) {
    refused.push({
      field: 'languages',
      reason: `${reading.languages.length} interface languages at once is a guess`,
    });
  } else {
    out.languages = [...reading.languages];
  }

  // --- english: a restatement, not an echo ---------------------------------
  // --- the refusal, corroborated -------------------------------------------
  if (!reading.asksForSoftware && namesSoftware(input)) {
    out.asksForSoftware = true;
    refused.push({
      field: 'asks_for_software',
      reason: 'the sentence names a program, so "not software" cannot be trusted',
    });
  }

  const english = reading.english.trim();
  if (english !== '') {
    if (!HAS_WORD.test(english)) {
      refused.push({ field: 'english', reason: 'the restatement has no words in it' });
    } else if (english.toLowerCase() === input.trim().toLowerCase()) {
      // The sentence handed back unchanged. It means "this was already
      // English" said the expensive way, and using it would embed the same
      // text twice for no reason.
      refused.push({ field: 'english', reason: 'the restatement is the sentence itself' });
    } else {
      out.english = english;
    }
  }

  // --- residual: a deletion of the sentence, or nothing --------------------
  const residual = reading.residual.trim();
  if (residual !== '') {
    if (!isDeletionOf(residual, input)) {
      refused.push({
        field: 'residual',
        reason: 'the residual is not the sentence with phrases deleted',
      });
    } else if (!HAS_WORD.test(residual)) {
      refused.push({ field: 'residual', reason: 'the residual has no words left in it' });
    } else {
      out.residual = residual;
    }
  }

  return out;
}

/* ===========================================================================
 * The merge
 * ======================================================================== */

/**
 * Which side wins where both read the same dimension.
 *
 * `rules-win` is what ships. `model-wins` exists so `eval/run.mjs --merge=…`
 * can measure the alternative rather than argue about it; the number it
 * produces is recorded in eval/baselines.md beside the shipped one.
 */
export type MergeMode = 'rules-win' | 'model-wins';

/**
 * Which dimensions the model is allowed to contribute at all.
 *
 * This is a measurement, not a preference, and the measurement is in
 * eval/baselines.md: `eval/run.mjs --accept=…` runs the whole golden set and
 * both negatives files for each combination, and what ships is what won.
 *
 * The short version of why the default is what it is:
 *
 *   pricing    helps. "without paying for anything", "without owning
 *              photoshop" — phrasings the word lists were never going to
 *              anticipate, and the guard above admits only two possible sets.
 *   flags      helps. "no server involved at all", "my notes stay as files on
 *              my own computer".
 *   platforms  hurts. The rules already ask for the shape a platform
 *              requirement takes ("on my phone", "for Linux") after a long
 *              argument recorded in lib/constraints.ts, and the model's extra
 *              readings were `web` and `self_hosted` invented out of "maps I
 *              can use when I have no mobile data" and "notes that stay as
 *              files on my own computer". Both emptied the page.
 *   languages  hurts, and worst of all. On five of the six non-English golden
 *              queries it returned the language the sentence was WRITTEN in —
 *              he, ru, fr, pt — which filters an overwhelmingly English
 *              catalogue down to almost nothing. Telling it not to, in capital
 *              letters, with a worked example, did not stop it. The rules read
 *              "with a Russian interface" correctly and keep it.
 */
export type ModelDimension = 'pricing' | 'platforms' | 'languages' | 'flags';

/**
 * What full-text search ranks on.
 *
 *   rules      the rules pass's residual — the sentence minus the phrases the
 *              regular expressions consumed, and nothing else
 *   shorter    whichever of the rules' residual and the model's deleted more,
 *              the model's having first been proved to be a deletion of the
 *              sentence rather than a rewrite of it
 *   restated   `shorter`, plus the English restatement appended for a sentence
 *              that is not in English
 *
 * `restated` is the one that needs a reason. The catalogue is written in
 * English and indexed with `to_tsvector('english', ...)`, so for a Hebrew,
 * Russian or Arabic sentence four of the five retrieval legs do nothing at all
 * — the words do not stem, the trigrams do not match, and only the vector leg
 * contributes. That is the largest known weakness in the product
 * (docs/loop-progress.md, Phase 2 onwards) and this is the first thing that can
 * touch it: with the restatement appended, a non-English sentence reaches the
 * lexical legs for the first time.
 *
 * The thing it must not become is the model writing the query. It cannot: the
 * restatement is validated, it is capped, it is only ever APPENDED to what the
 * person typed rather than replacing it, and it can name no tool the sentence
 * did not — because it is a translation of that sentence and nothing else is
 * ever sent to the model. Which of the three ships is measured.
 */
export type TextMode = 'rules' | 'shorter' | 'restated';

/** What gets embedded for the vector leg. */
export type EmbedMode = 'text' | 'english' | 'fused';

export interface MergeOptions {
  /**
   * Constraint keys the person switched off on the results screen.
   *
   * It has to reach the merge and not only `readQuery`, because a chip the
   * MODEL produced is a chip with a cross on it like any other and `?drop=`
   * knows nothing about which half of the reader made it. Without this, a
   * wrong constraint read by the model was undroppable — the chip disappeared
   * from the row and the filter stayed on.
   */
  dropped?: readonly string[];
  mode?: MergeMode;
  text?: TextMode;
  embed?: EmbedMode;
  /** Which dimensions the model may contribute. See `ModelDimension`. */
  accept?: readonly ModelDimension[];
  /**
   * Whether `asks_for_software: false` empties the page.
   *
   * On, and measured: it is the whole reason this phase can lift the near-miss
   * negatives that the relevance floor could not. Off is what the eval compares
   * it against.
   */
  refuse?: boolean;
}

export const MERGE_DEFAULTS: Required<MergeOptions> = {
  dropped: [],
  mode: 'rules-win',
  text: 'rules',
  embed: 'english',
  accept: ['pricing'],
  refuse: true,
};

export interface MergedReading {
  /** Every constraint that was read, from either side. The chips are these. */
  constraints: ReadConstraint[];
  /** The arguments `public.search_tools` takes. */
  filters: SearchConstraints;
  /** The text full-text search ranks on. Never anything the model composed. */
  text: string;
  /** The text to embed for the vector leg. May be the English restatement. */
  embedText: string;
  /** False when the sentence is not a request for a software tool at all. */
  asksForSoftware: boolean;
  /** The model's restatement, or ''. Reported; never a filter. */
  english: string;
  /** True when a model reading was available and used at all. */
  usedModel: boolean;
  /** Which dimensions the model contributed, for the report. */
  fromModel: string[];
  /** What the guards threw away. */
  refused: Refusal[];
}

/** A model constraint, in the shape the chips and the narrowing already take. */
function modelConstraints(
  guarded: GuardedReading,
  accept: readonly ModelDimension[],
): ReadConstraint[] {
  const out: ReadConstraint[] = [];
  const allowed = new Set(accept);

  if (allowed.has('pricing')) {
    if (sameSet(guarded.pricing, OPEN_SOURCE_SET)) {
      out.push({
        key: 'open-source',
        label: 'Open source',
        kind: 'pricing',
        pricing: ['open_source'],
      });
    } else if (guarded.pricing.length > 0) {
      out.push({ key: 'free', label: 'Free', kind: 'pricing', pricing: [...FREE_PRICING] });
    }
  }

  if (allowed.has('platforms')) {
    for (const platform of guarded.platforms) {
      out.push({
        key: `platform-${platform}`,
        label: platformLabel(platform),
        kind: 'platform',
        platforms: [platform],
      });
    }
  }
  if (allowed.has('flags')) {
    for (const flag of guarded.flags) {
      out.push({ key: `flag-${flag}`, label: flagLabel(flag), kind: 'flag', flag });
    }
  }
  if (allowed.has('languages')) {
    for (const code of guarded.languages) {
      out.push({ key: `lang-${code}`, label: languageName(code), kind: 'language', language: code });
    }
  }

  return out;
}

/**
 * Merge what the rules read with what the model read.
 *
 * Deliberately takes no sentence. Everything it needs about the sentence is
 * already in `rules` (the residual) and in `guarded` (which was built from the
 * sentence by `guardReading`, where the checks that need it live). A merge that
 * could see the raw text would be a merge that could start reading it, and
 * there is exactly one reader in this codebase.
 *
 * @param rules    `readQuery(query, dropped)` — already run, so the caller
 *                 keeps control of which chips were switched off
 * @param guarded  a guarded model reading, or null when there was none
 */
export function mergeReading(
  rules: RulesReading,
  guarded: GuardedReading | null,
  options: MergeOptions = {},
): MergedReading {
  const { dropped, mode, text: textMode, embed, accept, refuse } = {
    ...MERGE_DEFAULTS,
    ...options,
  };

  const rulesKinds = new Set(rules.constraints.map((c) => c.kind));
  const fromModel: string[] = [];

  let constraints = [...rules.constraints];

  if (guarded) {
    for (const candidate of modelConstraints(guarded, accept)) {
      const ruled = rulesKinds.has(candidate.kind);
      if (ruled && mode === 'rules-win') {
        // The rules already spoke for this dimension and they are the ones with
        // the tests. Nothing is added, and nothing is taken away.
        continue;
      }
      if (ruled && mode === 'model-wins') {
        constraints = constraints.filter((c) => c.kind !== candidate.kind);
        rulesKinds.delete(candidate.kind);
      }
      // The rules pass has already dropped its own; this drops the model's, so
      // the two halves behave identically on the screen.
      if (dropped.includes(candidate.key)) continue;
      constraints.push(candidate);
      fromModel.push(candidate.key);
    }
  }

  // De-duplicate by key: the rules and the model can both produce `free`, and a
  // person is not told "Free · Free".
  const seen = new Set<string>();
  constraints = constraints.filter((c) => {
    if (seen.has(c.key)) return false;
    seen.add(c.key);
    return true;
  });

  // The text. The rules' residual is the floor; the model's is used only when
  // it deleted MORE, which is what a model that read a constraint the rules
  // missed produces. It is already proved to be a deletion of the sentence, so
  // the worst it can do is take out a word that mattered — a ranking cost, never
  // a filter, and the golden set is what says whether it is worth it.
  let text = rules.text;
  if (
    textMode !== 'rules' &&
    guarded &&
    guarded.residual !== '' &&
    guarded.residual.length < rules.text.length
  ) {
    text = guarded.residual;
  }

  const english = guarded?.english ?? '';
  if (textMode === 'restated' && english !== '') {
    text = `${text} ${english}`.trim();
  }
  let embedText = text;
  if (english !== '') {
    if (embed === 'english') embedText = english;
    // Both, in one vector: the sentence keeps whatever the catalogue's own
    // non-English statements match on, and the restatement reaches the English
    // ones. Which of the three wins is measured, not assumed.
    else if (embed === 'fused') embedText = `${text} ${english}`.trim();
  }

  return {
    constraints,
    filters: toSearchConstraints(constraints),
    text,
    embedText,
    asksForSoftware: guarded && refuse ? guarded.asksForSoftware : true,
    english,
    usedModel: guarded !== null,
    fromModel,
    refused: guarded?.refused ?? [],
  };
}

/**
 * The whole reading, from a sentence and an optional model reading.
 *
 * One call, so the application, the eval harness and the tests compose the two
 * halves in the same order and cannot drift.
 */
export function readSentenceWith(
  query: string,
  dropped: readonly string[] = [],
  model: ModelReading | null = null,
  options: MergeOptions = {},
): MergedReading {
  const rules = readQuery(query, dropped);
  const guarded = model ? guardReading(model, query) : null;
  return mergeReading(rules, guarded, { ...options, dropped });
}
